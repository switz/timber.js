'use client';

import { useActionState } from 'react';
import { subscribe } from './actions';

export default function NewsletterPage() {
  const [state, action, pending] = useActionState(subscribe, null);

  return (
    <div>
      <h1 className="text-2xl font-bold text-walnut dark:text-stone-100 mb-2">Newsletter</h1>
      <p className="text-bark-light dark:text-stone-400 mb-6 text-sm">
        Sign up for timber.js updates. This form works without JavaScript.
      </p>

      <form action={action} className="flex gap-2">
        <input
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          className="flex-1 px-3 py-2 rounded-lg border border-grain dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-800 dark:text-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-bark-light/50"
        />
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 bg-walnut text-white rounded-lg text-sm font-medium hover:bg-timber-dark transition-colors disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
        >
          {pending ? '...' : 'Subscribe'}
        </button>
      </form>

      {state && 'data' in state && state.data?.success && (
        <p className="text-green-700 dark:text-green-400 text-sm mt-3">You're subscribed!</p>
      )}
    </div>
  );
}
