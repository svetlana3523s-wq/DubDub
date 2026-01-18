const path = require("path");

module.exports = {
  apps: [
    {
      name: "dubdub-api",
      cwd: __dirname,
      script: "apps/api/dist/index.js",
      env_file: "/var/www/dubdub/shared/.env",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "dubdub-worker",
      cwd: __dirname,
      script: "apps/worker/dist/index.js",
      env_file: "/var/www/dubdub/shared/.env",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "dubdub-web",
      cwd: path.join(__dirname, "apps/web"),
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      env_file: "/var/www/dubdub/shared/.env",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
