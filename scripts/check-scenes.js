const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

async function main() {
  const scenes = await p.scene.findMany({
    select: { id: true, title: true, s3KeyCuts: true }
  });
  console.log(JSON.stringify(scenes, null, 2));
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());

