export interface UserProfiles {
  leetcode?: string;
  codeforces?: string;
  gfg?: string;
  github?: string;
  hackerrank?: string;
  codechef?: string;
}

export interface UserGoals {
  dreamCompany: string;
  targetRole?: string;
  placementTimeline: string;
  oaDate?: string;
  daysLeft?: number;
}

export interface OnboardingPayload {
  profiles: UserProfiles;
  skillRatings: Record<string, number>; // topic key -> rating (1 to 5)
  goals: UserGoals;
  completedAt?: string;
}

export interface TopicItem {
  id: string;
  name: string;
  description?: string;
}

export interface TopicCategory {
  id: string;
  name: string;
  shortName: string;
  description: string;
  topics: TopicItem[];
}
