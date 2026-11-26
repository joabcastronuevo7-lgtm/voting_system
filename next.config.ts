import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Leave `experimental.agentFeedback` off: it makes `next dev` add an instruction to
  // AGENTS.md telling coding agents to send feedback to the framework's authors.
  // Leave `cacheComponents` off: with it, `next start` (16.4.6) answers a form posted before
  // JavaScript loads with a fragment of the page, which shows as a blank screen.
  // Pages with forms also stay outside <Suspense>, so they read without JavaScript.
  // Development logs would otherwise print every action's arguments, ballot choices included,
  // and the address of every claim link, which carries its secret token.
  logging: { serverFunctions: false, incomingRequests: { ignore: [/\/claim\//] } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
