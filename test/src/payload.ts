interface UserProfile {
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

export function generateBigPayload(id: string): UserProfile {
  return {
    id,
    username: `user_${id}`,
    email: `user${id}@example.com`,
    bio: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
    settings: {
      theme: Math.random() > 0.5 ? "light" : "dark",
      notifications: {
        email: true,
        sms: false,
        push: true,
      },
    },
    stats: {
      posts: Math.floor(Math.random() * 1000),
      followers: Math.floor(Math.random() * 10000),
      following: Math.floor(Math.random() * 500),
      createdAt: new Date().toISOString(),
    },
    posts: Array.from({ length: 10 }, (_, i) => ({
      id: `${id}-${i}`,
      title: `Post Title ${i}`,
      content: "Content here...".repeat(50),
      likes: Math.floor(Math.random() * 500),
      tags: ["benchmark", "test", "data"],
    })),
  };
}