import React, { useState } from 'react';

const EmojiPicker = ({ onEmojiSelect, selectedEmoji }) => {
  const [showPicker, setShowPicker] = useState(false);

  // Набор эмодзи для выбора
  const emojis = [
    '😀', '😂', '🥰', '😎', '🤩', '😍', '🤗', '🤑',
    '🤠', '🥸', '😈', '👻', '💩', '🙈', '🙉', '🙊',
    '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼',
    '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔',
    '🐧', '🐦', '🐤', '🦄', '🐝', '🦋', '🐢', '🐙',
    '🦑', '🦀', '🐬', '🐳', '🦈', '🐊', '🐅', '🐆',
    '🦓', '🦍', '🦧', '🐘', '🦛', '🦏', '🐪', '🐫',
    '🦒', '🦘', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏',
    '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐕‍🦺',
    '🐈', '🐓', '🦃', '🦤', '🦚', '🦜', '🦢', '🦩',
    '🕊️', '🐇', '🦝', '🦨', '🦡', '🦫', '🦦', '🦥',
    '🐁', '🐀', '🐿️', '🦔'
  ];

  const handleEmojiClick = (emoji) => {
    onEmojiSelect(emoji);
    setShowPicker(false);
  };

  return (
    <div className="emoji-picker">
      <div className="emoji-selection">
        <label htmlFor="emoji-input">Выберите аватар:</label>
        <div className="selected-emoji-container">
          <span className="selected-emoji">{selectedEmoji || '👤'}</span>
          <button
            className="emoji-toggle-btn"
            onClick={() => setShowPicker(!showPicker)}
            aria-label={showPicker ? "Закрыть выбор эмодзи" : "Открыть выбор эмодзи"}
          >
            {showPicker ? '✕' : '📁'}
          </button>
        </div>
      </div>

      {showPicker && (
        <div className="emoji-grid">
          {emojis.map((emoji, index) => (
            <button
              key={index}
              className="emoji-option"
              onClick={() => handleEmojiClick(emoji)}
              aria-label={`Выбрать эмодзи ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default EmojiPicker;
</ARG>
</ARG>