export interface UserProfile {
  id: 'me';
  name: string;
  email?: string;
  resumeText: string;
  parsed: {
    education: Array<{
      school: string;
      degree: string;
      major: string;
      gradYear: number;
    }>;
    experience: Array<{
      company: string;
      title: string;
      dates: string;
      description: string;
    }>;
    skills: string[];
    clubs: string[];
    hometown?: string;
    languages: string[];
  };
  targetCompanies: string[];
  targetRoles: string[];
}

export interface Profile {
  id: string;
  name: string;
  headline: string;
  currentCompany?: string;
  currentTitle?: string;
  location?: string;
  education: Array<{
    school: string;
    degree?: string;
    major?: string;
    dates?: string;
  }>;
  experience: Array<{
    company: string;
    title: string;
    dates: string;
  }>;
  skills?: string[];
  mutualConnections: number;
  mutualConnectionIds?: string[];
  connectionDegree: 1 | 2 | 3 | null;
  profilePictureUrl?: string;
  linkedinUrl: string;
  lastScraped: number;
  scrapedFrom: 'profile' | 'search' | 'alumni' | 'manual';
  warmnessScore?: number;
  sharedSignals?: string[];
}

export interface GeneratedMessage {
  id: string;
  profileId: string;
  draft: string;
  context: string;
  createdAt: number;
  sent: boolean;
}

export interface GraphSnapshot {
  profiles: Profile[];
  user: UserProfile | null;
  messages?: GeneratedMessage[];
}
