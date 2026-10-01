import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()

export async function seedContent() {
  const bots = [
    { name: 'Aurum Edge', symbol: 'XAUUSD', strategy: 'Trend following', description: 'A rules-based gold strategy built around session momentum and volatility-adjusted stops.', returnRate: '+18.4%', winRate: '64.2%', tradeCount: 128 },
    { name: 'Index Pulse', symbol: 'US100', strategy: 'Breakout', description: 'A measured breakout system designed for the US cash open and high-conviction continuation.', returnRate: '+12.8%', winRate: '59.8%', tradeCount: 96 },
    { name: 'London Drift', symbol: 'EURUSD', strategy: 'Mean reversion', description: 'A session-aware framework that looks for stretched moves returning toward fair value.', returnRate: '+9.6%', winRate: '61.1%', tradeCount: 74 },
  ]
  for (const bot of bots) {
    if (!await prisma.bot.findFirst({ where: { name: bot.name } })) await prisma.bot.create({ data: bot })
  }

  const courses = [
    { title: 'Read the Market', module: '01 · FOUNDATIONS', description: 'Learn to understand market structure, price action, and the sessions that shape movement.', lessonCount: 8, sortOrder: 1 },
    { title: 'Build Your Edge', module: '02 · STRATEGY', description: 'Turn a market idea into a rules-based strategy you can test and refine.', lessonCount: 12, sortOrder: 2 },
    { title: 'Risk, Refined', module: '03 · EXECUTION', description: 'Build consistent risk controls and an execution routine you can maintain.', lessonCount: 6, sortOrder: 3 },
  ]
  for (const course of courses) {
    if (!await prisma.course.findFirst({ where: { title: course.title } })) await prisma.course.create({ data: course })
  }
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/seed-cli.ts')) {
  seedContent().then(() => console.info('APEX content seeded.')).finally(() => prisma.$disconnect())
}