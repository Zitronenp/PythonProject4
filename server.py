import uuid
import logging
from threading import Lock
from flask import Flask, render_template, request, send_from_directory
from flask_socketio import SocketIO, emit, join_room
import os

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder='static', static_url_path='/static')
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "broken_telephone_secret")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading", logger=False, engineio_logger=False)

# ──────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────
MAX_PLAYERS = 20
MIN_PLAYERS_TO_START = 2

# ──────────────────────────────────────────────
# Game State
# ──────────────────────────────────────────────
game_lock = Lock()
players = {}  # sid → {"nickname": str, "is_host": bool, "status": str}
host_sid = None  # SID первого игрока
game_state = "lobby"  # lobby | writing | drawing | guessing | reveal
current_round_players = set()
round_index = 0
branches = []
assignments = {}
submitted = set()
reveal_branches = []  # Сериализованные цепочки для показа
reveal_branch_index = 0


def broadcast_player_list():
    pl = [{"sid": s, "nick": p["nickname"], "is_host": p["is_host"]} for s, p in players.items()]
    socketio.emit("lobby_update", {"players": pl, "host_sid": host_sid})


def all_players_ready():
    """Check if all current round players have submitted"""
    return all(
        players.get(s, {}).get("status") == "submitted" 
        for s in current_round_players 
        if s in players
    )


def try_continue_round():
    """Check if round can continue after player disconnect"""
    global game_state
    if game_state not in ("writing", "drawing", "guessing"):
        return
    
    # Check if all remaining players have submitted
    all_ready = all(
        players.get(s, {}).get("status") == "submitted" 
        for s in current_round_players 
        if s in players
    )
    
    if all_ready and len(current_round_players) >= MIN_PLAYERS_TO_START:
        # All submitted, continue
        active_branches = [b for b in branches if b["created_by"] in current_round_players]
        if all(len(b["chain"]) == len(current_round_players) for b in active_branches):
            start_reveal()
        else:
            prepare_next_phase()
    elif len(current_round_players) < MIN_PLAYERS_TO_START:
        # Not enough players
        game_state = "lobby"
        socketio.emit("phase_change", {
            "phase": "lobby", 
            "message": "Игра прервана: недостаточно игроков."
        })


# ──────────────────────────────────────────────
# Socket.IO Events
# ──────────────────────────────────────────────
@socketio.on("connect")
def handle_connect(): pass


@socketio.on("join_game")
def handle_join(data):
    global host_sid, game_state
    nickname = data.get("nickname", "").strip()
    
    if not nickname:
        emit("error", {"message": "Введите никнейм!"}, to=request.sid)
        return
    
    if len(nickname) > 20:
        emit("error", {"message": "Никнейм слишком длинный!"}, to=request.sid)
        return

    sid = request.sid
    with game_lock:
        if sid in players:
            emit("error", {"message": "Вы уже в игре!"}, to=sid)
            return
        
        if len(players) >= MAX_PLAYERS:
            emit("error", {"message": "Игра заполнена!"}, to=sid)
            return

        is_first = (host_sid is None)
        if is_first: 
            host_sid = sid

        players[sid] = {"nickname": nickname, "is_host": is_first, "status": "waiting"}
        join_room("lobby")

        # If joining during reveal, sync state immediately
        if game_state == "reveal":
            emit("phase_change", {
                "phase": "reveal",
                "branches": reveal_branches,
                "current_branch": reveal_branch_index,
                "host_sid": host_sid
            }, to=sid)
        elif game_state != "lobby":
            emit("joined_mid_round",
                 {"message": "Раунд уже идет. Вы начнете играть со следующего раунда, но можете смотреть показ."},
                 to=sid)

        broadcast_player_list()
        emit("join_success", {"is_host": is_first, "game_state": game_state}, to=sid)
        logger.info(f"Player {nickname} joined (SID: {sid}, Host: {is_first})")


@socketio.on("host_start_game")
def handle_host_start():
    if request.sid != host_sid:
        emit("error", {"message": "Только хост может начать игру!"}, to=request.sid)
        return
    
    if len(players) < MIN_PLAYERS_TO_START:
        emit("error", {"message": f"Нужно минимум {MIN_PLAYERS_TO_START} игрока!"}, to=request.sid)
        return
    
    start_round()


def start_round():
    global game_state, round_index, branches, submitted, current_round_players
    game_state = "writing"
    round_index = 0
    branches = []
    submitted = set()
    current_round_players = set(players.keys())

    for sid in current_round_players:
        players[sid]["status"] = "waiting"
        branches.append({"id": str(uuid.uuid4()), "chain": [], "created_by": sid})

    socketio.emit("phase_change", {"phase": "writing"})


@socketio.on("submit_text")
def handle_submit_text(data):
    sid = request.sid
    if sid not in current_round_players or game_state != "writing": return
    text = data.get("text", "").strip()
    if not text: emit("error", {"message": "Введите фразу!"}, to=sid); return

    with game_lock:
        for b in branches:
            if b["created_by"] == sid:
                b["chain"].append(
                    {"type": "text", "author_sid": sid, "author_nick": players[sid]["nickname"], "content": text})
                break
        submitted.add(sid)
        players[sid]["status"] = "submitted"
        if all_players_ready():
            prepare_next_phase()


def prepare_next_phase():
    global game_state, round_index, submitted, assignments
    round_index += 1
    submitted = set()
    for sid in current_round_players:
        if sid in players:
            players[sid]["status"] = "waiting"

    # Ротация: сдвигаем предметы на 1
    items = [{"branch_id": b["id"], "content": b["chain"][-1]["content"]} for b in branches]
    items = items[1:] + items[:1]

    assignments = {}
    player_sids = list(current_round_players)
    for i, sid in enumerate(player_sids):
        if sid not in players: continue
        item = items[i % len(items)]
        assignments[sid] = {"branch_id": item["branch_id"], "content": item["content"]}

    game_state = "drawing" if round_index % 2 == 1 else "guessing"
    socketio.emit("phase_change", {"phase": game_state, "assignments": {sid: a for sid, a in assignments.items()}})


@socketio.on("submit_drawing")
def handle_submit_drawing(data):
    sid = request.sid
    if sid not in assignments or game_state != "drawing": return
    with game_lock:
        b = next((b for b in branches if b["id"] == assignments[sid]["branch_id"]), None)
        if b:
            b["chain"].append({"type": "image", "author_sid": sid, "author_nick": players[sid]["nickname"],
                               "content": data.get("image", "")})
        submitted.add(sid)
        players[sid]["status"] = "submitted"
        if all_players_ready():
            if all(len(b["chain"]) == len(current_round_players) for b in branches):
                start_reveal()
            else:
                prepare_next_phase()


@socketio.on("submit_guess")
def handle_submit_guess(data):
    sid = request.sid
    if sid not in assignments or game_state != "guessing": return
    text = data.get("text", "").strip()
    if not text: emit("error", {"message": "Введите описание!"}, to=sid); return
    with game_lock:
        b = next((b for b in branches if b["id"] == assignments[sid]["branch_id"]), None)
        if b:
            b["chain"].append(
                {"type": "text", "author_sid": sid, "author_nick": players[sid]["nickname"], "content": text})
        submitted.add(sid)
        players[sid]["status"] = "submitted"
        if all_players_ready():
            if all(len(b["chain"]) == len(current_round_players) for b in branches):
                start_reveal()
            else:
                prepare_next_phase()


def start_reveal():
    global game_state, reveal_branches, reveal_branch_index
    game_state = "reveal"
    reveal_branch_index = 0
    reveal_branches = []
    for b in branches:
        reveal_branches.append({"chain": [{"type": e["type"], "author_nick": e["author_nick"], "content": e["content"]}
                                          for e in b["chain"]]})

    socketio.emit("phase_change", {
        "phase": "reveal",
        "branches": reveal_branches,
        "host_sid": host_sid,
        "current_branch": 0
    })


@socketio.on("host_next_branch")
def handle_next_branch():
    global reveal_branch_index
    if request.sid != host_sid: return
    reveal_branch_index += 1
    socketio.emit("reveal_update", {"current_branch": reveal_branch_index, "total_branches": len(reveal_branches)})


@socketio.on("host_new_game")
def handle_new_game():
    global game_state, players, host_sid, current_round_players, branches, submitted, assignments, reveal_branches, reveal_branch_index, round_index
    if request.sid != host_sid: return

    # Сброс игры, но оставляем игроков
    game_state = "lobby"
    current_round_players.clear()
    branches = []
    submitted.clear()
    assignments = {}
    reveal_branches = []
    reveal_branch_index = 0
    round_index = 0

    for sid in players:
        players[sid]["status"] = "waiting"

    broadcast_player_list()
    socketio.emit("phase_change", {"phase": "lobby", "host_sid": host_sid})


@socketio.on("disconnect")
def handle_disconnect():
    global host_sid, game_state, current_round_players, branches, submitted, assignments, reveal_branches, reveal_branch_index, round_index

    sid = request.sid
    with game_lock:
        if sid not in players:
            return

        # Запоминаем данные игрока
        nickname = players[sid]["nickname"]
        was_host = players[sid]["is_host"]
        was_in_round = sid in current_round_players
        had_submitted = sid in submitted

        # Удаляем игрока из всех структур
        del players[sid]
        current_round_players.discard(sid)
        submitted.discard(sid)  # ВАЖНО: удаляем из submitted!

        # Если игрок был в текущем раунде и игра не в лобби и не в показе
        if was_in_round and game_state not in ("lobby", "reveal"):
            # Удаляем его ветку из branches
            branches = [b for b in branches if b["created_by"] != sid]

            # Проверяем, осталось ли достаточно игроков
            if len(current_round_players) < 2:
                # Недостаточно игроков - завершаем раунд
                game_state = "lobby"
                round_index = 0
                branches = []
                assignments = {}
                submitted.clear()
                socketio.emit("phase_change", {"phase": "lobby",
                                               "message": f"Игрок {nickname} вышел. Недостаточно игроков для продолжения."})
            else:
                # Пересоздаём assignments для оставшихся игроков
                if branches and len(branches) >= 2:
                    # Синхронизируем цепочки: у всех должна быть одинаковая длина
                    min_chain_len = min(len(b["chain"]) for b in branches)
                    for b in branches:
                        while len(b["chain"]) > min_chain_len:
                            b["chain"].pop()

                    # Пересоздаём assignments на основе текущих branches
                    items = []
                    for b in branches:
                        if b["chain"]:
                            items.append({"branch_id": b["id"], "content": b["chain"][-1]["content"]})
                        else:
                            items.append({"branch_id": b["id"], "content": ""})

                    # Ротация
                    if items:
                        items = items[1:] + items[:1]

                    assignments = {}
                    player_sids = list(current_round_players)
                    for i, player_sid in enumerate(player_sids):
                        if player_sid in players and items:
                            item = items[i % len(items)]
                            assignments[player_sid] = {"branch_id": item["branch_id"], "content": item["content"]}

                    # Сбрасываем статусы для всех, кроме тех, кто уже отправил?
                    # Лучше сбросить все статусы, чтобы все ждали новое задание
                    for player_sid in current_round_players:
                        if player_sid in players:
                            players[player_sid]["status"] = "waiting"
                    submitted.clear()

                    # Отправляем обновлённые задания всем оставшимся игрокам
                    if assignments:
                        socketio.emit("phase_change", {
                            "phase": game_state,
                            "assignments": {sid: a for sid, a in assignments.items()}
                        })
                else:
                    # Недостаточно веток - завершаем раунд
                    game_state = "lobby"
                    socketio.emit("phase_change",
                                  {"phase": "lobby", "message": f"Игрок {nickname} вышел. Игра прервана."})

        # Передача хоста при отключении
        if was_host:
            remaining = list(players.keys())
            if remaining:
                host_sid = remaining[0]
                players[host_sid]["is_host"] = True
            else:
                host_sid = None
                game_state = "lobby"

        broadcast_player_list()

        # Оповещаем всех об уходе игрока
        socketio.emit("player_left", {"nickname": nickname, "sid": sid})


@socketio.on("check_game_status")
def handle_check_status():
    """Клиент проверяет, не зависла ли игра"""
    global game_state
    with game_lock:
        if game_state not in ("lobby", "reveal"):
            # Проверяем, все ли игроки из current_round_players ещё в игре
            active_players = [s for s in current_round_players if s in players]
            if len(active_players) != len(current_round_players):
                # Есть вышедшие игроки, которые всё ещё в current_round_players
                current_round_players.clear()
                current_round_players.update(active_players)

                # Удаляем submitted вышедших
                submitted.intersection_update(active_players)

                if len(current_round_players) < 2:
                    game_state = "lobby"
                    socketio.emit("phase_change", {"phase": "lobby", "message": "Игра восстановлена после ошибки."})
                else:
                    # Проверяем, все ли готовы
                    all_ready = all(
                        players.get(s, {}).get("status") == "submitted" for s in current_round_players if s in players)
                    if all_ready and len(current_round_players) >= 2:
                        if all(len(b["chain"]) == len(current_round_players) for b in branches if
                               b["created_by"] in current_round_players):
                            start_reveal()
                        else:
                            prepare_next_phase()


@socketio.on("request_lobby_update")
def handle_request_lobby_update():
    """Клиент запрашивает обновление лобби"""
    broadcast_player_list()


@app.route("/")
def index():
    return render_template("index.html")


@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory('static', filename)


if __name__ == "__main__":
    print("🎨 Испорченный телефончик — запуск на http://localhost:5000")
    print("✨ Новая стильная версия с анимациями!")
    print("✅ Исправлена проблема с выходом игроков во время игры")
    socketio.run(app, host="0.0.0.0", port=5000, debug=True, allow_unsafe_werkzeug=True)