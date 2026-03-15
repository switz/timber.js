'use client';

import { useActionState } from 'react';
import { submitContact } from './actions';

export default function ContactPage() {
  const [state, action, pending] = useActionState(submitContact, null);

  return (
    <div>
      <h1 className="text-2xl font-bold text-walnut dark:text-stone-100 mb-2">Contact</h1>
      <p className="text-bark-light dark:text-stone-400 mb-6 text-sm">
        This form demonstrates server actions with progressive enhancement — it works without
        JavaScript.
      </p>

      <form action={action} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-bark dark:text-stone-300 mb-1">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="w-full px-3 py-2 rounded-lg border border-grain dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-800 dark:text-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-bark-light/50"
          />
        </div>

        <div>
          <label htmlFor="message" className="block text-sm font-medium text-bark dark:text-stone-300 mb-1">
            Message
          </label>
          <textarea
            id="message"
            name="message"
            required
            rows={4}
            className="w-full px-3 py-2 rounded-lg border border-grain dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-800 dark:text-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-bark-light/50 resize-y"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 bg-walnut text-white rounded-lg text-sm font-medium hover:bg-timber-dark transition-colors disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
        >
          {pending ? 'Sending...' : 'Send'}
        </button>

        {state && 'validationErrors' in state && (
          <p className="text-red-600 dark:text-red-400 text-sm">
            Please check your input and try again.
          </p>
        )}
        {state && 'data' in state && state.data?.success && (
          <p className="text-green-700 dark:text-green-400 text-sm">Message sent!</p>
        )}
      </form>
    </div>
  );
}
