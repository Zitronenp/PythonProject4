import React, { useState } from 'react';
import './App.css';
import AvatarSelection from './components/AvatarSelection';

function App() {
  const [user, setUser] = useState(null);
  const [gameStarted, setGameStarted] = useState(false);

  const handleAvatarSelect = (userData) => {
    setUser(userData);
    setGameStarted(true);
  };

  const handleStartGame = () => {
    // Логика запуска игры
    console.log('Игра начинается с пользователем:', user);
  };

  if (!gameStarted) {
    return (
      <div className="App">
        <header className="App-header">
          <h1>Игра</h1>
        </header>
        <main>
          <AvatarSelection onAvatarSelect={handleAvatarSelect} />
        </main>
      </div>
    );
  }

  // Если игра уже началась, отображаем основную игровую логику
  return (
    <div className="App">
      <header className="App-header">
        <h1>Игра</h1>
        <p>Добро пожаловать, {user?.nickname}!</p>
        <p>Ваш аватар: {user?.avatar}</p>
      </header>
      <main>
        <button onClick={handleStartGame}>Начать игру</button>
      </main>
    </div>
  );
}

export default App;
</ARG>
</ARG>