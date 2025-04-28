export interface UserProfile {
  id: string;
  username: string;
  email: string;
  bio: string;
  settings: {
    theme: 'light' | 'dark';
    notifications: {
      email: boolean;
      sms: boolean;
      push: boolean;
    };
  };
  stats: {
    posts: number;
    followers: number;
    following: number;
    createdAt: string;
  };
  posts: {
    id: string;
    title: string;
    content: string;
    likes: number;
    tags: string[];
  }[];
}