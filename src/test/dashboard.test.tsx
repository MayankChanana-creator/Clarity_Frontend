import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { isDashboardPayload } from '../lib/dashboard/api';
import {
  MOCK_DASHBOARD_PAYLOAD,
  MOCK_EMPTY_DASHBOARD_PAYLOAD,
  createMockDashboardPayload,
  MOCK_REVISION_TOPICS,
} from '../lib/dashboard/mock';
import { TopicCard } from '../components/dashboard/TopicCard';
import { TodayRevisionSection } from '../components/dashboard/TodayRevisionSection';
import { SandboxSection } from '../components/dashboard/SandboxSection';
import { AdaptiveSet } from '../components/dashboard/AdaptiveSet';
import { RevisionTopic } from '../lib/dashboard/types';

describe('Dashboard Data Layer & Type Guard', () => {
  it('validates a correct DashboardPayload against the typed contract', () => {
    expect(isDashboardPayload(MOCK_DASHBOARD_PAYLOAD)).toBe(true);
    expect(isDashboardPayload(MOCK_EMPTY_DASHBOARD_PAYLOAD)).toBe(true);
  });

  it('rejects malformed payloads violating the contract', () => {
    expect(isDashboardPayload(null)).toBe(false);
    expect(isDashboardPayload({})).toBe(false);
    expect(isDashboardPayload({ user: { name: 123 } })).toBe(false);
    expect(
      isDashboardPayload({
        ...MOCK_DASHBOARD_PAYLOAD,
        today: {
          ...MOCK_DASHBOARD_PAYLOAD.today,
          topics: [
            {
              ...MOCK_REVISION_TOPICS[0],
              band: 'invalid_band', // invalid band
            },
          ],
        },
      })
    ).toBe(false);
  });

  it('supports oaRelevance as null without violating contract', () => {
    const topicWithNullRelevance: RevisionTopic = {
      ...MOCK_REVISION_TOPICS[0],
      oaRelevance: null,
    };
    const payloadWithNullRelevance = {
      ...MOCK_DASHBOARD_PAYLOAD,
      today: {
        ...MOCK_DASHBOARD_PAYLOAD.today,
        topics: [topicWithNullRelevance],
      },
    };
    expect(isDashboardPayload(payloadWithNullRelevance)).toBe(true);
  });

  it('generates customized mock payloads properly', () => {
    const custom = createMockDashboardPayload({
      target: {
        company: 'Apple',
        oaDate: '2026-10-01T00:00:00.000Z',
        daysLeft: 21,
      },
      clearScore: {
        value: 92,
        label: 'Top 3% Placement Readiness',
      },
    });
    expect(custom.target.company).toBe('Apple');
    expect(custom.target.daysLeft).toBe(21);
    expect(custom.clearScore.value).toBe(92);
    expect(isDashboardPayload(custom)).toBe(true);
  });
});

describe('TopicCard Component', () => {
  it('renders collapsed topic card with band text label and color, rating, priority and reason tags', () => {
    const topic = MOCK_REVISION_TOPICS[0]; // Dynamic Programming (weak)
    const html = renderToString(
      <TopicCard
        topic={topic}
        companyName="Google"
        isExpanded={false}
        onToggle={() => {}}
      />
    );

    // Subject
    expect(html).toContain('DSA');
    // Topic Label
    expect(html).toContain('Dynamic Programming (2D &amp; State Optimization)');
    // Text label for band (never color alone)
    expect(html).toContain('Weak');
    // Rating
    expect(html).toContain('2');
    expect(html).toContain('/5');
    // Priority
    expect(html).toContain('High');
    expect(html).toContain('Priority');
    // Why Selected
    expect(html).toContain(topic.whySelected);
    // Company relevance line
    expect(html).toContain('Asked in');
    expect(html).toContain('19');
    expect(html).toContain('Google');
    expect(html).toContain('OAs');
    // Estimated minutes
    expect(html).toContain('35');
    expect(html).toContain('min');
    expect(html).toContain('Start Revision');
  });

  it('hides company relevance line when oaRelevance is null and does not crash', () => {
    const topicWithoutRelevance: RevisionTopic = {
      ...MOCK_REVISION_TOPICS[0],
      oaRelevance: null,
    };
    const html = renderToString(
      <TopicCard
        topic={topicWithoutRelevance}
        companyName="Google"
        isExpanded={false}
        onToggle={() => {}}
      />
    );

    expect(html).not.toContain('Asked in');
    expect(html).toContain('Dynamic Programming');
  });

  it('renders expanded details when isExpanded is true', () => {
    const topic = MOCK_REVISION_TOPICS[0];
    const html = renderToString(
      <TopicCard
        topic={topic}
        companyName="Google"
        isExpanded={true}
        onToggle={() => {}}
      />
    );

    expect(html).toContain('Subtopics to Revise');
    expect(html).toContain('Grid DP &amp; memoization tables');
    expect(html).toContain('Learning Goal');
    expect(html).toContain(topic.learningGoal);
    expect(html).toContain('Practice Questions');
    expect(html).toContain('Take Quick Quiz');
  });
});

describe('TodayRevisionSection Component', () => {
  it('renders section header with days left, company name and topic counts', () => {
    const html = renderToString(
      <TodayRevisionSection
        payload={MOCK_DASHBOARD_PAYLOAD}
        isWelcome={false}
      />
    );

    expect(html).toContain('days to your');
    expect(html).toContain('Google');
    expect(html).toContain('OA');
    expect(html).toContain('Today&#x27;s Revision Plan');
    expect(html).toContain('topics to revise today');
    expect(html).toContain('min');
    expect(html).toContain('All');
    expect(html).toContain('Weak');
    expect(html).toContain('Developing');
    expect(html).toContain('Strong');
  });

  it('renders empty state when topics array is empty', () => {
    const html = renderToString(
      <TodayRevisionSection
        payload={MOCK_EMPTY_DASHBOARD_PAYLOAD}
        isWelcome={false}
      />
    );

    expect(html).toContain(
      'All rated topics are above novice level. Keep up the high consistency!'
    );
  });
});

describe('AdaptiveSet Component', () => {
  it('renders adaptive problem cards with difficulties', () => {
    const html = renderToString(
      <AdaptiveSet problems={MOCK_DASHBOARD_PAYLOAD.today.adaptiveSet} />
    );

    expect(html).toContain('Today&#x27;s 3-Problem Adaptive Set');
    expect(html).toContain('Kth Smallest Element in a Sorted Matrix');
    expect(html).toContain('Medium');
    expect(html).toContain('Hard');
  });
});

describe('SandboxSection Component', () => {
  it('renders simulated OA sandbox with badge, pool title and launch button', () => {
    const html = renderToString(
      <SandboxSection payload={MOCK_DASHBOARD_PAYLOAD} />
    );

    expect(html).toContain('CODE RED');
    expect(html).toContain('Simulated Online Assessment Sandbox');
    expect(html).toContain('Google 2026 Question Pool');
    expect(html).toContain('Launch Mock OA');
    expect(html).toContain('70');
    expect(html).toContain('Minutes');
  });
});
