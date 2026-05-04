"""Realtime backend for a Gartic Phone-like party game.

Игроки в одной общей сессии по очереди:
1) пишут фразы,
2) рисуют по чужой фразе,
3) угадывают по чужому рисунку,
после чего все цепочки показываются в reveal.
"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room


MAX_PLAYERS = 20
MIN_PLAYERS = 2
LOBBY_ROOM = "lobby"


@dataclass
class Player:
    sid: str
    nickname: str
    is_host: bool = False
    status: str = "waiting"


@dataclass
class Entry:
    type: str  # text | image
    author_sid: str
    author_nick: str
    content: str


@dataclass
class Branch:
    id: str
    created_by: str
    chain: list[Entry] = field(default_factory=list)


class GameState:
    def __init__(self) -> None:
        self.lock = Lock()
        self.players: dict[str, Player] = {}
        self.host_sid: str | None = None
        self.phase: str = "lobby"  # lobby|writing|drawing|guessing|reveal
        self.current_round_players: list[str] = []
        self.round_index: int = 0
        self.branches: list[Branch] = []
        self.assignments: dict[str, dict[str, str]] = {}
        self.submitted: set[str] = set()
        self.reveal_branches: list[dict[str, Any]] = []
        self.reveal_index: int = 0
        self.round_timer_seconds: int = 180

    def reset_to_lobby(self) -> None:
        self.phase = "lobby"
        self.current_round_players = []
        self.round_index = 0
        self.branches = []
        self.assignments = {}
        self.submitted = set()
        self.reveal_branches = []
        self.reveal_index = 0


app = Flask(__name__, template_folder="../templates", static_folder="../static")
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "broken_telephone_secret")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")
state = GameState()


@app.get("/")
def index() -> str:
    return render_template("index.html")


def _emit_error(message: str, sid: str) -> None:
    emit("error", {"message": message}, to=sid)


def _broadcast_lobby() -> None:
    payload = {
        "players": [
            {"sid": p.sid, "nick": p.nickname, "is_host": p.is_host}
            for p in state.players.values()
        ],
        "host_sid": state.host_sid,
        "timer_seconds": state.round_timer_seconds,
    }
    socketio.emit("lobby_update", payload, to=LOBBY_ROOM)


def _return_to_lobby(message: str | None = None) -> None:
    state.reset_to_lobby()
    for player in state.players.values():
        player.status = "waiting"
    socketio.emit(
        "phase_change",
        {"phase": "lobby", "message": message or "Показ завершён. Хост может начать новую игру."},
        to=LOBBY_ROOM,
    )
    _broadcast_lobby()


def _all_submitted() -> bool:
    return all(
        sid in state.players and state.players[sid].status == "submitted"
        for sid in state.current_round_players
    )


def _active_branches() -> list[Branch]:
    active = set(state.current_round_players)
    return [b for b in state.branches if b.created_by in active]


def _start_round() -> None:
    state.phase = "writing"
    state.round_index = 0
    state.submitted = set()
    state.assignments = {}
    state.current_round_players = list(state.players.keys())
    state.branches = [
        Branch(id=str(uuid.uuid4()), created_by=sid) for sid in state.current_round_players
    ]
    for sid in state.current_round_players:
        state.players[sid].status = "waiting"

    socketio.emit("phase_change", {"phase": "writing", "timer_seconds": state.round_timer_seconds})


def _prepare_next_phase() -> None:
    state.round_index += 1
    state.submitted = set()
    for sid in state.current_round_players:
        if sid in state.players:
            state.players[sid].status = "waiting"

    items: list[dict[str, str]] = []
    for b in _active_branches():
        if not b.chain:
            continue
        items.append({"branch_id": b.id, "content": b.chain[-1].content})

    if not items:
        return

    rotated = items[1:] + items[:1]
    state.assignments = {}
    for idx, sid in enumerate(state.current_round_players):
        if sid not in state.players:
            continue
        state.assignments[sid] = rotated[idx % len(rotated)]

    state.phase = "drawing" if state.round_index % 2 == 1 else "guessing"
    socketio.emit(
        "phase_change",
        {
            "phase": state.phase,
            "assignments": state.assignments,
            "timer_seconds": state.round_timer_seconds,
        },
    )


def _start_reveal() -> None:
    state.phase = "reveal"
    state.reveal_index = 0
    state.reveal_branches = [
        {
            "chain": [
                {"type": e.type, "author_nick": e.author_nick, "content": e.content}
                for e in b.chain
            ]
        }
        for b in _active_branches()
    ]

    socketio.emit(
        "phase_change",
        {
            "phase": "reveal",
            "branches": state.reveal_branches,
            "host_sid": state.host_sid,
            "current_branch": 0,
        },
    )


def _end_or_continue_after_submission() -> None:
    if not _all_submitted():
        return

    active = _active_branches()
    target_len = len(state.current_round_players)
    if active and all(len(b.chain) >= target_len for b in active):
        _start_reveal()
    else:
        _prepare_next_phase()


@socketio.on("connect")
def on_connect() -> None:
    pass


@socketio.on("join_game")
def on_join_game(data: dict[str, Any]) -> None:
    sid = request.sid
    nickname = str((data or {}).get("nickname", "")).strip()

    if not nickname:
        _emit_error("Введите никнейм!", sid)
        return
    if len(nickname) > 20:
        _emit_error("Никнейм слишком длинный!", sid)
        return

    with state.lock:
        if sid in state.players:
            _emit_error("Вы уже в игре!", sid)
            return
        if len(state.players) >= MAX_PLAYERS:
            _emit_error("Игра заполнена!", sid)
            return

        is_first = state.host_sid is None
        if is_first:
            state.host_sid = sid

        state.players[sid] = Player(sid=sid, nickname=nickname, is_host=is_first)
        join_room(LOBBY_ROOM)

        emit("join_success", {"is_host": is_first, "game_state": state.phase}, to=sid)

        if state.phase == "reveal":
            emit(
                "phase_change",
                {
                    "phase": "reveal",
                    "branches": state.reveal_branches,
                    "current_branch": state.reveal_index,
                    "host_sid": state.host_sid,
                },
                to=sid,
            )
        elif state.phase != "lobby":
            emit(
                "joined_mid_round",
                {
                    "message": "Раунд уже идет. Вы начнете со следующего раунда, но можете смотреть показ.",
                },
                to=sid,
            )

        _broadcast_lobby()


@socketio.on("host_start_game")
def on_host_start_game(data: dict[str, Any] | None = None) -> None:
    sid = request.sid
    with state.lock:
        if sid != state.host_sid:
            _emit_error("Только хост может начать игру!", sid)
            return
        if len(state.players) < MIN_PLAYERS:
            _emit_error(f"Нужно минимум {MIN_PLAYERS} игрока!", sid)
            return
        if data and "timer_seconds" in data:
            try:
                state.round_timer_seconds = max(0, min(int(data["timer_seconds"]), 1800))
            except (TypeError, ValueError):
                pass
        _start_round()


@socketio.on("host_set_timer")
def on_host_set_timer(data: dict[str, Any]) -> None:
    sid = request.sid
    with state.lock:
        if sid != state.host_sid or state.phase != "lobby":
            return
        try:
            timer_seconds = int((data or {}).get("timer_seconds", state.round_timer_seconds))
        except (TypeError, ValueError):
            _emit_error("Некорректное значение таймера.", sid)
            return

        state.round_timer_seconds = max(0, min(timer_seconds, 1800))
        _broadcast_lobby()


@socketio.on("submit_text")
def on_submit_text(data: dict[str, Any]) -> None:
    sid = request.sid
    text = str((data or {}).get("text", "")).strip()
    if state.phase != "writing" or sid not in state.current_round_players:
        return
    if not text:
        _emit_error("Введите фразу!", sid)
        return

    with state.lock:
        own_branch = next((b for b in state.branches if b.created_by == sid), None)
        if own_branch is None:
            return
        own_branch.chain.append(
            Entry(type="text", author_sid=sid, author_nick=state.players[sid].nickname, content=text)
        )
        state.submitted.add(sid)
        state.players[sid].status = "submitted"
        _end_or_continue_after_submission()


@socketio.on("submit_drawing")
def on_submit_drawing(data: dict[str, Any]) -> None:
    sid = request.sid
    if state.phase != "drawing" or sid not in state.assignments:
        return

    image = str((data or {}).get("image", "")).strip()
    if not image:
        _emit_error("Пустой рисунок не отправляется!", sid)
        return

    with state.lock:
        branch_id = state.assignments[sid]["branch_id"]
        branch = next((b for b in state.branches if b.id == branch_id), None)
        if branch is None:
            return
        branch.chain.append(
            Entry(type="image", author_sid=sid, author_nick=state.players[sid].nickname, content=image)
        )
        state.submitted.add(sid)
        state.players[sid].status = "submitted"
        _end_or_continue_after_submission()


@socketio.on("submit_guess")
def on_submit_guess(data: dict[str, Any]) -> None:
    sid = request.sid
    if state.phase != "guessing" or sid not in state.assignments:
        return

    text = str((data or {}).get("text", "")).strip()
    if not text:
        _emit_error("Введите описание!", sid)
        return

    with state.lock:
        branch_id = state.assignments[sid]["branch_id"]
        branch = next((b for b in state.branches if b.id == branch_id), None)
        if branch is None:
            return
        branch.chain.append(
            Entry(type="text", author_sid=sid, author_nick=state.players[sid].nickname, content=text)
        )
        state.submitted.add(sid)
        state.players[sid].status = "submitted"
        _end_or_continue_after_submission()


@socketio.on("host_next_branch")
@socketio.on("next_reveal_branch")
def on_next_reveal_branch() -> None:
    sid = request.sid
    with state.lock:
        if sid != state.host_sid or state.phase != "reveal":
            return
        state.reveal_index += 1
        if state.reveal_index >= len(state.reveal_branches):
            _return_to_lobby()
            return

        socketio.emit(
            "phase_change",
            {
                "phase": "reveal",
                "branches": state.reveal_branches,
                "host_sid": state.host_sid,
                "current_branch": state.reveal_index,
            },
        )


@socketio.on("host_new_game")
def on_host_new_game() -> None:
    sid = request.sid
    with state.lock:
        if sid != state.host_sid:
            return
        _start_round()


@socketio.on("disconnect")
def on_disconnect() -> None:
    sid = request.sid
    with state.lock:
        player = state.players.pop(sid, None)
        if player is None:
            return

        if sid == state.host_sid:
            state.host_sid = next(iter(state.players.keys()), None)
            if state.host_sid is not None:
                state.players[state.host_sid].is_host = True

        if sid in state.current_round_players:
            state.current_round_players = [p for p in state.current_round_players if p != sid]

        if len(state.players) < MIN_PLAYERS:
            _return_to_lobby("Недостаточно игроков.")
        elif state.phase in {"writing", "drawing", "guessing"}:
            _end_or_continue_after_submission()
            _broadcast_lobby()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port, debug=False, allow_unsafe_werkzeug=True)
