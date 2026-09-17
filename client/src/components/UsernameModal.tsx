import React, { useState, useEffect, useRef } from 'react';

interface UsernameModalProps {
  isOpen: boolean;
  onSubmit: (username: string) => void;
  initialValue?: string;
  title?: string;
  subtitle?: string;
}

export function UsernameModal({
  isOpen,
  onSubmit,
  initialValue = '',
  title = 'Welcome to Watch Together',
  subtitle = 'Choose a username to get started',
}: UsernameModalProps) {
  const [username, setUsername] = useState(initialValue);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = username.trim();
    if (trimmed.length < 2) {
      setError('Username must be at least 2 characters');
      return;
    }
    if (trimmed.length > 20) {
      setError('Username must be at most 20 characters');
      return;
    }
    setError('');
    onSubmit(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
         role="dialog" aria-modal="true" aria-label="Username modal">
      <div className="glass w-full max-w-md mx-4 rounded-2xl p-8 animate-bounce-in">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="text-5xl mb-4">🎬</div>
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          <p className="text-surface-400 mt-2 text-sm">{subtitle}</p>
        </div>

        <form onSubmit={handleSubmit}>
          <label htmlFor="username-input" className="block text-sm font-medium text-surface-300 mb-2">
            Username
          </label>
          <input
            ref={inputRef}
            id="username-input"
            type="text"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              if (error) setError('');
            }}
            placeholder="Enter your name..."
            className="w-full px-4 py-3 rounded-xl bg-surface-900/80 border border-surface-700 
                       text-white placeholder-surface-500 focus:outline-none focus:border-primary-500 
                       focus:ring-1 focus:ring-primary-500 transition-colors"
            maxLength={20}
            autoComplete="off"
            aria-invalid={!!error}
            aria-describedby={error ? 'username-error' : undefined}
          />
          {error && (
            <p id="username-error" className="mt-2 text-sm text-accent-rose" role="alert">
              {error}
            </p>
          )}
          <div className="text-right mt-1 text-xs text-surface-500">
            {username.trim().length}/20
          </div>

          <button
            type="submit"
            className="w-full mt-4 px-6 py-3 rounded-xl bg-gradient-to-r from-primary-600 to-primary-700 
                       text-white font-semibold hover:from-primary-500 hover:to-primary-600 
                       transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]
                       focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 
                       focus:ring-offset-surface-900"
            aria-label="Continue with this username"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
