'use client';

import { useEffect, useState } from 'react';

export default function Counter() {
  const [state, setState] = useState(1);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setState((i) => i + 1);
    }, 1000);

    return () => clearInterval(intervalId);
  }, []);

  return state;
}
