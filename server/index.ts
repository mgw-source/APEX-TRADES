import 'dotenv/config'
import { randomBytes, createHash } from 'node:crypto'
import { basename, extname, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'
import multer from 'multer'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import nodemailer from 'nodemailer'
import Stripe from 'stripe'
import { Server as SocketServer } from 'socket.io'
import { z } from 'zod'
import { prisma, seedContent } from './seed.js'

const app = express()
const httpServer = createServer(app)
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
const port = Number(process.env.PORT || 4000)
const jwtSecret = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'local-development-secret-change-before-deploying')
const isProduction = process.env.NODE_ENV === 'production'
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null
const smtpPort = Number(process.env.SMTP_PORT || 587)
const mailer = process.env.SMTP_HOST ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port: smtpPort, secure: smtpPort === 465, auth: process.env.SMTP_USER && process.env.SMTP_PASSWORD ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined }) : null
const io = new SocketServer(httpServer, { cors: { origin: frontendUrl, credentials: true } })
const uploadDirectory = resolve('uploads')
mkdirSync(uploadDirectory, { recursive: true })
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (_request, file, callback) => callback(null, `${Date.now()}-${randomBytes(8).toString('hex')}${extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const extension = extname(file.originalname).toLowerCase()
    callback(null, ['.zip', '.ex4', '.ex5', '.mq4', '.mq5', '.mp4', '.webm', '.mov', '.pdf'].includes(extension))
  },
})

if (!jwtSecret || (isProduction && jwtSecret.length < 32)) throw new Error('JWT_SECRET must be set to at least 32 characters in production.')

type SessionUser = { id: string; email: string; name: string; isAdmin: boolean; isMember: boolean }
type AuthRequest = Request & { sessionUser?: SessionUser }
const asyncRoute = (handler: (request: AuthRequest, response: Response, next: NextFunction) => Promise<unknown>) => (request: Request, response: Response, next: NextFunction) => Promise.resolve(handler(request as AuthRequest, response, next)).catch(next)
const registerSchema = z.object({ name: z.string().trim().min(2).max(80), email: z.email().max(254), password: z.string().min(8).max(128) })
const loginSchema = z.object({ email: z.email().max(254), password: z.string().min(1).max(128) })
const emailSchema = z.object({ email: z.email().max(254) })
const tokenSchema = z.object({ token: z.string().min(32), newPassword: z.string().min(8).max(128) })
const subscriptionSchema = z.object({ interval: z.enum(['monthly', 'yearly']) })
const tradeSchema = z.object({ symbol: z.string().trim().min(2).max(20), side: z.enum(['LONG', 'SHORT']), entry: z.coerce.number().positive(), notes: z.string().trim().max(1000).optional() })
const copySchema = z.object({ provider: z.string().trim().min(2).max(60), accountName: z.string().trim().min(2).max(80) })
const assetLink = z.string().refine((value) => value.startsWith('/api/assets/') || z.url().safeParse(value).success)

function cleanEmail(email: string) { return email.trim().toLowerCase() }
function tokenHash(value: string) { return createHash('sha256').update(value).digest('hex') }
function userDto(user: { id: string; name: string; email: string; role: string }, isMember: boolean) {
  return { id: user.id, name: user.name, email: user.email, isAdmin: user.role === 'ADMIN', isMember }
}
async function activeSubscription(userId: string) {
  return prisma.subscription.findFirst({ where: { userId, status: 'ACTIVE', OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gte: new Date() } }] }, orderBy: { createdAt: 'desc' } })
}
function setSession(response: Response, user: { id: string; email: string; name: string; role: string }, isMember: boolean) {
  const token = jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: '7d' })
  response.cookie('apex_session', token, { httpOnly: true, secure: isProduction, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/' })
  return userDto(user, isMember)
}
const requireAuth = asyncRoute(async (request, response, next) => {
  const token = request.cookies?.apex_session
  if (!token) return response.status(401).json({ error: 'Sign in to continue.' })
  try {
    const payload = jwt.verify(token, jwtSecret) as jwt.JwtPayload
    if (!payload.sub) return response.status(401).json({ error: 'Your session has expired.' })
    const user = await prisma.user.findUnique({ where: { id: payload.sub } })
    if (!user) return response.status(401).json({ error: 'Your session has expired.' })
    request.sessionUser = userDto(user, Boolean(await activeSubscription(user.id)))
    next()
  } catch { return response.status(401).json({ error: 'Your session has expired.' }) }
})
const requireMember = asyncRoute(async (request, response, next) => {
  const user = request.sessionUser
  if (!user) return response.status(401).json({ error: 'Sign in to continue.' })
  if (!user.isMember && !user.isAdmin) return response.status(403).json({ error: 'An active membership is required.' })
  next()
})
const requireAdmin = (request: AuthRequest, response: Response, next: NextFunction) => {
  if (!request.sessionUser?.isAdmin) return response.status(403).json({ error: 'Owner access is required.' })
  next()
}
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false })
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false })

app.set('trust proxy', 1)
app.use(helmet())
app.use(cors({ origin: frontendUrl, credentials: true }))
app.use(cookieParser())
app.use('/api', apiLimiter)

app.post('/api/subscriptions/webhook', express.raw({ type: 'application/json' }), asyncRoute(async (request, response) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return response.status(503).json({ error: 'Stripe webhooks are not configured.' })
  const signature = request.headers['stripe-signature']
  if (typeof signature !== 'string') return response.status(400).json({ error: 'Missing Stripe signature.' })
  let event: Stripe.Event
  try { event = stripe.webhooks.constructEvent(request.body, signature, process.env.STRIPE_WEBHOOK_SECRET) }
  catch { return response.status(400).json({ error: 'Invalid webhook signature.' }) }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    if (session.mode === 'subscription' && session.client_reference_id && typeof session.subscription === 'string') {
      const subscription = await stripe.subscriptions.retrieve(session.subscription)
      await prisma.subscription.upsert({ where: { stripeSubscriptionId: subscription.id }, create: { userId: session.client_reference_id, stripeCustomerId: String(session.customer), stripeSubscriptionId: subscription.id, status: subscription.status === 'active' || subscription.status === 'trialing' ? 'ACTIVE' : 'INACTIVE', interval: subscription.items.data[0]?.price.recurring?.interval === 'year' ? 'YEARLY' : 'MONTHLY', currentPeriodEnd: new Date(subscription.items.data[0]?.current_period_end ? subscription.items.data[0].current_period_end * 1000 : Date.now()) }, update: { status: subscription.status === 'active' || subscription.status === 'trialing' ? 'ACTIVE' : 'INACTIVE' } })
    }
  }
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription
    await prisma.subscription.updateMany({ where: { stripeSubscriptionId: subscription.id }, data: { status: subscription.status === 'active' || subscription.status === 'trialing' ? 'ACTIVE' : 'INACTIVE', cancelAtPeriodEnd: subscription.cancel_at_period_end, currentPeriodEnd: new Date(subscription.items.data[0]?.current_period_end ? subscription.items.data[0].current_period_end * 1000 : Date.now()) } })
  }
  response.json({ received: true })
}))

app.use(express.json({ limit: '1mb' }))
app.get('/api/health', (_request, response) => response.json({ status: 'ok', database: 'connected', payments: stripe ? 'configured' : 'demo' }))

app.post('/api/auth/register', authLimiter, asyncRoute(async (request, response) => {
  const parsed = registerSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: parsed.error.issues[0]?.message || 'Please check your details.' })
  const email = cleanEmail(parsed.data.email)
  if (await prisma.user.findUnique({ where: { email } })) return response.status(409).json({ error: 'An account with this email already exists.' })
  const user = await prisma.user.create({ data: { name: parsed.data.name, email, passwordHash: await bcrypt.hash(parsed.data.password, 12) } })
  response.status(201).json({ user: setSession(response, user, false) })
}))

app.post('/api/auth/login', authLimiter, asyncRoute(async (request, response) => {
  const parsed = loginSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Enter a valid email and password.' })
  const user = await prisma.user.findUnique({ where: { email: cleanEmail(parsed.data.email) } })
  if (!user || !await bcrypt.compare(parsed.data.password, user.passwordHash)) return response.status(401).json({ error: 'Email or password is incorrect.' })
  response.json({ user: setSession(response, user, Boolean(await activeSubscription(user.id))) })
}))

app.post('/api/auth/logout', (_request, response) => {
  response.clearCookie('apex_session', { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' })
  response.json({ ok: true })
})

app.get('/api/auth/me', asyncRoute(async (request, response) => {
  const token = request.cookies?.apex_session
  if (!token) return response.json({ user: null })
  try {
    const payload = jwt.verify(token, jwtSecret) as jwt.JwtPayload
    if (!payload.sub) return response.json({ user: null })
    const user = await prisma.user.findUnique({ where: { id: payload.sub } })
    return response.json({ user: user ? userDto(user, Boolean(await activeSubscription(user.id))) : null })
  } catch { return response.json({ user: null }) }
}))
app.get('/api/users/me', requireAuth, (request: AuthRequest, response) => response.json({ user: request.sessionUser }))

app.post('/api/auth/password-reset', authLimiter, asyncRoute(async (request, response) => {
  const body = request.body as Record<string, unknown>
  if (typeof body.token === 'string') {
    const parsed = tokenSchema.safeParse(body)
    if (!parsed.success) return response.status(400).json({ error: 'Enter the reset token and a new password of at least 8 characters.' })
    const user = await prisma.user.findFirst({ where: { resetTokenHash: tokenHash(parsed.data.token), resetExpiresAt: { gt: new Date() } } })
    if (!user) return response.status(400).json({ error: 'This reset link is invalid or has expired.' })
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 12), resetTokenHash: null, resetExpiresAt: null } })
    return response.json({ message: 'Password updated. You can now sign in.' })
  }
  const parsed = emailSchema.safeParse(body)
  if (!parsed.success) return response.status(400).json({ error: 'Enter a valid email address.' })
  const user = await prisma.user.findUnique({ where: { email: cleanEmail(parsed.data.email) } })
  const result: { message: string; resetToken?: string } = { message: 'If that email is registered, reset instructions are on the way.' }
  if (user) {
    const token = randomBytes(32).toString('hex')
    await prisma.user.update({ where: { id: user.id }, data: { resetTokenHash: tokenHash(token), resetExpiresAt: new Date(Date.now() + 30 * 60 * 1000) } })
    if (mailer) await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: user.email, subject: 'Reset your APEX TRADES password', text: `Reset your password within 30 minutes: ${frontendUrl}/?reset=${token}` })
    else if (!isProduction) result.resetToken = token
    else return response.status(503).json({ error: 'Password reset email is not configured. Please contact support.' })
  }
  response.json(result)
}))

app.post('/api/demo/member', asyncRoute(async (_request, response) => {
  if (isProduction) return response.status(404).json({ error: 'Demo access is disabled.' })
  const email = 'demo@apextrades.local'
  let user = await prisma.user.findUnique({ where: { email } })
  if (!user) user = await prisma.user.create({ data: { email, name: 'Alex Morgan', passwordHash: await bcrypt.hash(randomBytes(24).toString('hex'), 12) } })
  await prisma.subscription.upsert({ where: { stripeSubscriptionId: 'apex-demo-membership' }, create: { userId: user.id, stripeSubscriptionId: 'apex-demo-membership', status: 'ACTIVE', interval: 'MONTHLY', currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }, update: { userId: user.id, status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } })
  response.json({ user: setSession(response, user, true) })
}))

app.get('/api/subscriptions/plans', (_request, response) => response.json({ plans: [{ interval: 'monthly', amount: 3900, currency: 'usd' }, { interval: 'yearly', amount: 37200, currency: 'usd' }] }))
app.post('/api/subscriptions/checkout', requireAuth, asyncRoute(async (request, response) => {
  const parsed = subscriptionSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Choose a valid billing interval.' })
  const user = request.sessionUser!
  if (user.isMember) return response.json({ user })
  const priceId = parsed.data.interval === 'yearly' ? process.env.STRIPE_YEARLY_PRICE_ID : process.env.STRIPE_MONTHLY_PRICE_ID
  if (stripe && priceId) {
    const databaseUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    const customer = await stripe.customers.create({ email: databaseUser.email, name: databaseUser.name, metadata: { userId: databaseUser.id } })
    const session = await stripe.checkout.sessions.create({ mode: 'subscription', customer: customer.id, client_reference_id: databaseUser.id, line_items: [{ price: priceId, quantity: 1 }], success_url: `${frontendUrl}/?checkout=success`, cancel_url: `${frontendUrl}/?checkout=cancelled`, allow_promotion_codes: true })
    return response.json({ url: session.url })
  }
  if (isProduction) return response.status(503).json({ error: 'Membership checkout is not configured. Please contact support.' })
  await prisma.subscription.create({ data: { userId: user.id, status: 'ACTIVE', interval: parsed.data.interval.toUpperCase(), currentPeriodEnd: new Date(Date.now() + (parsed.data.interval === 'yearly' ? 365 : 30) * 24 * 60 * 60 * 1000) } })
  const databaseUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
  response.json({ user: setSession(response, databaseUser, true) })
}))

app.post('/api/subscriptions/cancel', requireAuth, asyncRoute(async (request, response) => {
  const user = request.sessionUser!
  const subscription = await activeSubscription(user.id)
  if (!subscription) return response.status(404).json({ error: 'No active subscription was found.' })
  if (stripe && subscription.stripeSubscriptionId && subscription.stripeSubscriptionId !== 'apex-demo-membership') {
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, { cancel_at_period_end: true })
    await prisma.subscription.update({ where: { id: subscription.id }, data: { cancelAtPeriodEnd: true } })
    return response.json({ user, cancelAtPeriodEnd: true })
  }
  await prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'CANCELED' } })
  const databaseUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
  response.json({ user: setSession(response, databaseUser, false) })
}))

app.get('/api/bots', requireAuth, requireMember, asyncRoute(async (request, response) => {
  const bots = await prisma.bot.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' }, include: { activations: { where: { userId: request.sessionUser!.id }, select: { active: true } } } })
  response.json({ bots: bots.map(({ activations, ...bot }) => ({ ...bot, activated: activations[0]?.active || false })) })
}))
app.patch('/api/bots/:id/activation', requireAuth, requireMember, asyncRoute(async (request, response) => {
  const parsed = z.object({ active: z.boolean() }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Choose whether to activate this bot.' })
  const bot = await prisma.bot.findUnique({ where: { id: String(request.params.id) } })
  if (!bot || !bot.active) return response.status(404).json({ error: 'Trading bot not found.' })
  const activation = await prisma.botActivation.upsert({ where: { userId_botId: { userId: request.sessionUser!.id, botId: bot.id } }, create: { userId: request.sessionUser!.id, botId: bot.id, active: parsed.data.active }, update: { active: parsed.data.active } })
  response.json({ activation })
}))
app.get('/api/bots/:id/download', requireAuth, requireMember, asyncRoute(async (request, response) => {
  const bot = await prisma.bot.findUnique({ where: { id: String(request.params.id) } })
  if (!bot?.downloadUrl) return response.status(404).json({ error: 'No download is available for this bot.' })
  response.json({ url: bot.downloadUrl })
}))
app.get('/api/courses', requireAuth, requireMember, asyncRoute(async (request, response) => {
  const courses = await prisma.course.findMany({ orderBy: { sortOrder: 'asc' }, include: { progress: { where: { userId: request.sessionUser!.id }, select: { progress: true } } } })
  response.json({ courses: courses.map(({ progress, ...course }) => ({ ...course, progress: progress[0]?.progress || 0 })) })
}))
app.put('/api/courses/:id/progress', requireAuth, requireMember, asyncRoute(async (request, response) => {
  const parsed = z.object({ progress: z.number().int().min(0).max(100) }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Progress must be a number from 0 to 100.' })
  const courseId = Number(request.params.id)
  const course = await prisma.course.findFirst({ where: { sortOrder: courseId } })
  if (!course) return response.status(404).json({ error: 'Course not found.' })
  const saved = await prisma.courseProgress.upsert({ where: { userId_courseId: { userId: request.sessionUser!.id, courseId: course.id } }, create: { userId: request.sessionUser!.id, courseId: course.id, progress: parsed.data.progress }, update: { progress: parsed.data.progress } })
  response.json({ progress: saved.progress })
}))
app.get('/api/trades', requireAuth, requireMember, asyncRoute(async (_request, response) => response.json({ trades: await prisma.trade.findMany({ orderBy: { openedAt: 'desc' }, take: 50 }) })))
app.get('/api/assets/:filename', requireAuth, requireMember, (request, response) => {
  const filename = basename(String(request.params.filename))
  response.sendFile(resolve(uploadDirectory, filename), (error) => { if (error && !response.headersSent) response.status(404).json({ error: 'Asset not found.' }) })
})
app.post('/api/copy/connect', requireAuth, requireMember, asyncRoute(async (request, response) => {
  const parsed = copySchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Enter a valid broker and account name.' })
  const connection = await prisma.copyConnection.upsert({ where: { userId_provider_accountName: { userId: request.sessionUser!.id, provider: parsed.data.provider, accountName: parsed.data.accountName } }, create: { userId: request.sessionUser!.id, ...parsed.data }, update: { connected: true } })
  response.status(201).json({ connection })
}))
app.post('/api/copy/disconnect', requireAuth, requireMember, asyncRoute(async (request, response) => {
  const parsed = copySchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Enter a valid broker and account name.' })
  await prisma.copyConnection.updateMany({ where: { userId: request.sessionUser!.id, provider: parsed.data.provider, accountName: parsed.data.accountName }, data: { connected: false } })
  response.json({ ok: true })
}))

app.get('/api/admin/users', requireAuth, requireAdmin, asyncRoute(async (_request, response) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, name: true, email: true, role: true, createdAt: true, subscriptions: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, interval: true, currentPeriodEnd: true } } } })
  response.json({ users })
}))
app.post('/api/admin/bots', requireAuth, requireAdmin, asyncRoute(async (request, response) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(100), symbol: z.string().trim().min(2).max(20), strategy: z.string().trim().min(2).max(80), description: z.string().trim().min(5).max(2000), downloadUrl: assetLink.optional(), returnRate: z.string().max(30).optional(), winRate: z.string().max(30).optional(), tradeCount: z.number().int().min(0).optional() }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Please provide a name, symbol, strategy, and description.' })
  response.status(201).json({ bot: await prisma.bot.create({ data: parsed.data }) })
}))
app.post('/api/admin/assets', requireAuth, requireAdmin, (request, response, next) => {
  upload.single('file')(request, response, (error: unknown) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') return response.status(413).json({ error: 'Files must be 50 MB or smaller.' })
    if (error) return response.status(400).json({ error: 'The upload could not be processed.' })
    if (!request.file) return response.status(400).json({ error: 'Choose a supported file: ZIP, MetaTrader, MP4, WebM, MOV, or PDF.' })
    next()
  })
}, (request, response) => response.status(201).json({ url: `/api/assets/${request.file!.filename}`, filename: request.file!.originalname, size: request.file!.size }))
app.post('/api/admin/courses', requireAuth, requireAdmin, asyncRoute(async (request, response) => {
  const parsed = z.object({ title: z.string().trim().min(2).max(120), module: z.string().trim().min(2).max(100), description: z.string().trim().min(5).max(2000), lessonCount: z.number().int().min(1), sortOrder: z.number().int().min(0).optional(), assetUrl: assetLink.optional() }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Please provide a title, module, description, and lesson count.' })
  response.status(201).json({ course: await prisma.course.create({ data: parsed.data }) })
}))
app.post('/api/admin/trades', requireAuth, requireAdmin, asyncRoute(async (request, response) => {
  const parsed = tradeSchema.safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Please provide a valid symbol, direction, and positive entry price.' })
  const trade = await prisma.trade.create({ data: { ...parsed.data, symbol: parsed.data.symbol.toUpperCase() } })
  io.emit('trade:new', trade)
  response.status(201).json({ trade })
}))
app.patch('/api/admin/users/:id/subscription', requireAuth, requireAdmin, asyncRoute(async (request, response) => {
  const parsed = z.object({ status: z.enum(['ACTIVE', 'CANCELED', 'INACTIVE']) }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Choose a valid subscription status.' })
  const user = await prisma.user.findUnique({ where: { id: String(request.params.id) } })
  if (!user) return response.status(404).json({ error: 'Member not found.' })
  const current = await prisma.subscription.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } })
  if (current) await prisma.subscription.update({ where: { id: current.id }, data: { status: parsed.data.status } })
  else await prisma.subscription.create({ data: { userId: user.id, status: parsed.data.status } })
  response.json({ ok: true })
}))

app.use((_request, response) => response.status(404).json({ error: 'Route not found.' }))
app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  console.error(error)
  if (response.headersSent) return
  response.status(500).json({ error: 'An unexpected server error occurred.' })
})

let goldPrice = 2328.42
io.on('connection', (socket) => socket.emit('market:tick', { symbol: 'XAUUSD', price: goldPrice, change: 0.84, at: new Date().toISOString() }))
setInterval(() => {
  goldPrice = Math.max(2200, goldPrice + (Math.random() - 0.48) * 1.35)
  io.emit('market:tick', { symbol: 'XAUUSD', price: Number(goldPrice.toFixed(2)), change: 0.84, at: new Date().toISOString() })
}, 3000)

async function start() {
  await prisma.$connect()
  await seedContent()
  const adminEmail = cleanEmail(process.env.ADMIN_EMAIL || '')
  const adminPassword = process.env.ADMIN_PASSWORD
  if (adminEmail && adminPassword) {
    const existing = await prisma.user.findUnique({ where: { email: adminEmail } })
    if (existing) await prisma.user.update({ where: { id: existing.id }, data: { role: 'ADMIN' } })
    else await prisma.user.create({ data: { email: adminEmail, name: 'APEX Owner', passwordHash: await bcrypt.hash(adminPassword, 12), role: 'ADMIN' } })
  }
  httpServer.listen(port, () => console.info(`APEX TRADES API listening on http://localhost:${port}`))
}
start().catch((error) => { console.error('API startup failed:', error); process.exitCode = 1 })