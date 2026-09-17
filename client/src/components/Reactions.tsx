import React from 'react';
import { useRoom } from '../context/RoomContext';

export function Reactions() {
  const { state } = useRoom();

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden z-50">
      {state.reactions.map((reaction) => (
        <div
          key={reaction.id}
          className="reaction-float"
          style={{ left: `${reaction.x}%` }}
          aria-hidden="true"
        >
          {reaction.emoji}
        </div>
      ))}
    </div>
  );
}
