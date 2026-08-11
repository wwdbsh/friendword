// BRANDED BOUNDARIES — T013 / WUI-4 · GAP-7 (Issue #50).
//
// Before this suite the product had no boundary files at all: a mistyped
// campaign slug, an expired campaign and a thrown server error all rendered
// Next.js's own "404 | This page could not be found." — the only screen in the
// product with no wordmark, no way home and no relation to the design system.
//
// These tests mount the boundary components themselves rather than asserting
// on a route, because what regressed in the audit was the CONTENT of the dead
// end: is there an exit, does it say something true, and does the retry
// actually call the framework's reset. `app/**` boundary files are one-line
// wrappers over these, so a boundary that stops rendering an exit fails here.
/* global describe, expect, it, afterEach */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import GlobalError from '../app/global-error';
import RootNotFound from '../app/not-found';
import RouteError from '../app/error';
import PitchError from '../app/p/[campaignSlug]/error';
import PitchNotFound from '../app/p/[campaignSlug]/not-found';
import InboxLoading from '../app/inbox/loading';
import { CampaignEnded } from '../src/components/CampaignEnded';

afterEach(() => {
  cleanup();
});

/** Every dead end has to leave a way out — that is the whole point of them. */
function expectsAWayHome(): void {
  const home = screen.getByRole('link', { name: 'Go to Friendword' });
  expect(home.getAttribute('href')).toBe('/');
}

describe('the app-wide 404', () => {
  it('names the page as missing and offers the way home', () => {
    render(<RootNotFound />);

    expect(screen.getByRole('heading', { name: 'This page isn’t here.' })).toBeTruthy();
    expectsAWayHome();
  });
});

describe('the campaign 404', () => {
  it('does not assert WHICH reason applies', () => {
    // §12: this boundary catches a typo, a paused page, an archived page and a
    // gated one. The server deliberately refuses to tell them apart, so the
    // copy may not either — it says "may".
    render(<PitchNotFound />);

    const body = screen.getByText(/The link may be mistyped/u).textContent ?? '';
    expect(body).toContain('may be mistyped');
    expect(body).toContain('may have ended or been taken down');
  });

  it('gives a stranger from a reel somewhere else to go', () => {
    render(<PitchNotFound />);

    expect(screen.getByRole('link', { name: 'See a demo pitch' }).getAttribute('href')).toBe(
      '/p/demo-blair',
    );
    expectsAWayHome();
  });
});

describe('the ended-campaign screen (GAP-7)', () => {
  it('states the fact and promises nothing about it coming back', () => {
    render(<CampaignEnded />);

    expect(screen.getByRole('heading', { name: 'This campaign has ended.' })).toBeTruthy();
    const page = screen.getByRole('main').textContent ?? '';
    expect(page).toContain('no longer public');
    // An expired campaign cannot be resumed and cannot receive interest, so
    // none of these may appear.
    expect(page).not.toMatch(/check back|soon|again later|will be|reach out|send/iu);
  });

  it('is a different screen from the 404, not a reworded one', () => {
    // The whole value of GAP-7 is that a reader can tell "it ended" apart from
    // "you typed it wrong".
    const ended = render(<CampaignEnded />).container.textContent ?? '';
    cleanup();
    const missing = render(<PitchNotFound />).container.textContent ?? '';

    expect(ended).not.toBe(missing);
    expect(ended).toContain('ended');
    expect(missing).toContain('mistyped');
  });
});

describe('the error boundaries', () => {
  it('retries through the framework reset rather than reloading', () => {
    const reset = vi.fn();
    render(<RouteError error={new Error('boom')} reset={reset} />);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('never prints the thrown message to the reader', () => {
    // A server error message can carry internals — connection strings, ids,
    // stack frames. The reader gets the one fact this screen actually knows.
    render(<PitchError error={new Error('PGRST301 jwt expired for user 4f2a')} reset={vi.fn()} />);

    const page = screen.getByRole('main').textContent ?? '';
    expect(page).not.toContain('PGRST301');
    expect(page).toContain('Something went wrong on our side');
    expectsAWayHome();
  });

  it('says nothing about whether the campaign still exists', () => {
    // A failed load is not evidence either way, so the pitch error boundary
    // must not imply the page is gone (that is the 404's job).
    render(<PitchError error={new Error('boom')} reset={vi.fn()} />);

    const page = screen.getByRole('main').textContent ?? '';
    expect(page).toContain('can’t tell you from here');
    expect(page).not.toMatch(/isn’t here|has ended|taken down/u);
  });

  it('re-declares the design tokens when the root layout is what failed', () => {
    // global-error replaces the whole document, so the layout that normally
    // injects the palette is exactly what is missing. Without this the sticker
    // card would render with no colours at all.
    render(<GlobalError error={new Error('boom')} reset={vi.fn()} />);

    // React hoists <style> out of the tree it is written in, so the assertion
    // is on the document rather than the render container.
    const declared = Array.from(document.querySelectorAll('style'))
      .map((node) => node.textContent ?? '')
      .join('');
    expect(declared).toContain('--color-background');
    expect(declared).toContain('--color-ink');
    expect(screen.getByRole('heading', { name: 'Friendword didn’t load.' })).toBeTruthy();
  });
});

describe('the loading boundary', () => {
  it('announces the wait and claims no duration for it', () => {
    render(<InboxLoading />);

    // Same sentence the inbox itself shows while it reads the session, so a
    // cold start is one wait rather than two screens.
    expect(screen.getByRole('heading', { name: 'Opening your inbox…' })).toBeTruthy();
    const region = screen.getByRole('main').textContent ?? '';
    expect(region).not.toMatch(/second|moment|shortly|almost/iu);
    expect(document.querySelector('[aria-live="polite"]')).toBeTruthy();
  });
});
