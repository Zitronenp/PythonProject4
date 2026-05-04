.avatar-selection {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  max-width: 500px;
  margin: 0 auto;
  background-color: rgba(0, 0, 0, 0.7);
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  color: white;
}

.avatar-selection h2 {
  margin-bottom: 20px;
  text-align: center;
  font-size: 1.5em;
}

.avatar-selection form {
  width: 100%;
}

.nickname-input {
  margin-bottom: 20px;
}

.nickname-input label {
  display: block;
  margin-bottom: 5px;
  font-weight: bold;
}

.nickname-input input {
  width: 100%;
  padding: 10px;
  border-radius: 5px;
  border: none;
  background-color: rgba(255, 255, 255, 0.9);
  font-size: 1em;
}

.emoji-selection {
  margin-bottom: 20px;
}

.emoji-selection label {
  display: block;
  margin-bottom: 10px;
  font-weight: bold;
}

.emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 10px;
  margin-bottom: 20px;
}

.emoji-option {
  background: none;
  border: none;
  font-size: 1.5em;
  cursor: pointer;
  padding: 5px;
  border-radius: 5px;
  transition: all 0.2s ease;
}

.emoji-option:hover {
  transform: scale(1.2);
  background-color: rgba(255, 255, 255, 0.2);
}

.emoji-option.selected {
  background-color: rgba(255, 255, 255, 0.3);
  transform: scale(1.2);
}

.avatar-selection button {
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: 5px;
  background-color: #4CAF50;
  color: white;
  font-size: 1.1em;
  font-weight: bold;
  cursor: pointer;
  transition: background-color 0.3s ease;
}

.avatar-selection button:hover:not(:disabled) {
  background-color: #45a049;
}

.avatar-selection button:disabled {
  background-color: #cccccc;
  cursor: not-allowed;
}

@media (max-width: 600px) {
  .emoji-grid {
    grid-template-columns: repeat(6, 1fr);
  }

  .avatar-selection {
    padding: 15px;
  }

  .avatar-selection h2 {
    font-size: 1.3em;
  }
}

@media (max-width: 400px) {
  .emoji-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}
</ARG>
</ARG>