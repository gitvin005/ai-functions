export default async ({ req, res }) => {

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }

  if (req.method === 'OPTIONS') return res.send('', 204, headers)
  if (req.method !== 'POST') return res.json({ error: 'Method not allowed' }, 405, headers)

  // ✅ log all env vars (values hidden but check if defined)
  console.log('ENV CHECK:', {
    endpoint: !!process.env.APPWRITE_ENDPOINT,
    projectId: !!process.env.APPWRITE_PROJECT_ID,
    apiKey: !!process.env.APPWRITE_API_KEY,
    dbId: process.env.DB_ID,                        // ← show actual value
    userMetaCollection: process.env.USER_META_COLLECTION,  // ← show actual value
    historyCollection: process.env.HISTORY_COLLECTION,     // ← show actual value
    openRouterKey: !!process.env.OPENROUTER_API_KEY
  })

  let body = {}
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  } catch {
    return res.json({ error: 'Invalid JSON body' }, 400, headers)
  }

  const { userId, prompt, contentType } = body

  if (!userId || !prompt || !contentType) {
    return res.json({ error: 'Missing required fields' }, 400, headers)
  }

  if (prompt.length > 2000) {
    return res.json({ error: 'Prompt too long' }, 400, headers)
  }

  const normalizedType = contentType.toLowerCase().trim()
  const ALLOWED_TYPES = ['blog post', 'ad copy', 'social media post', 'email', 'product description']

  if (!ALLOWED_TYPES.includes(normalizedType)) {
    return res.json({ error: `Invalid content type` }, 400, headers)
  }

  try {
    const { Client, Databases, Query, ID } = await import('node-appwrite')

    const client = new Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT)
      .setProject(process.env.APPWRITE_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY)

    const db = new Databases(client)

    // ✅ log before first DB call
    console.log('Fetching user meta...', {
      dbId: process.env.DB_ID,
      collection: process.env.USER_META_COLLECTION,
      userId
    })

    const metaRes = await db.listDocuments(
      process.env.DB_ID,
      process.env.USER_META_COLLECTION,
      [Query.equal('userId', userId)]
    )

    if (!metaRes.documents.length) {
      return res.json({ error: 'User not found' }, 404, headers)
    }

    let meta = metaRes.documents[0]
    const plan = meta.plan || 'free'
    const RATE_LIMIT = {
      free: { requestsPerMinute: 3, creditsPerDay: 10 },
      pro:  { requestsPerMinute: 10, creditsPerDay: 100 }
    }
    const limits = RATE_LIMIT[plan] || RATE_LIMIT.free

    // reset daily credits
    const today = new Date().toDateString()
    const lastReset = new Date(meta.lastReset).toDateString()

    if (today !== lastReset) {
      meta = await db.updateDocument(
        process.env.DB_ID,
        process.env.USER_META_COLLECTION,
        meta.$id,
        {
          credits: limits.creditsPerDay,
          lastReset: new Date().toISOString()
        }
      )
    }

    if (meta.credits <= 0) {
      return res.json({
        error: `Daily limit reached. ${plan === 'free' ? 'Upgrade to Pro for 100 credits/day.' : 'Credits reset tomorrow.'}`,
        upgradeRequired: plan === 'free'
      }, 403, headers)
    }

    // ✅ log before rate limit check
    console.log('Checking rate limit...', {
      dbId: process.env.DB_ID,
      historyCollection: process.env.HISTORY_COLLECTION
    })

    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString()
    const recentRes = await db.listDocuments(
      process.env.DB_ID,
      process.env.HISTORY_COLLECTION,
      [
        Query.equal('userId', userId),
        Query.greaterThan('createdAt', oneMinuteAgo)
      ]
    )

    if (recentRes.total >= limits.requestsPerMinute) {
      return res.json({
        error: `Rate limit hit. Max ${limits.requestsPerMinute} requests/minute.`,
        retryAfter: 60
      }, 429, headers)
    }

    // ✅ log before AI call
    console.log('Calling OpenRouter AI...')

    const aiRes = await globalThis.fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://visaya-ai.netlify.app',
          'X-Title': 'Visaya AI'
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          max_tokens: 1000,
          messages: [
            {
              role: 'system',
              content: `You are a professional content writer. Only generate ${contentType} content.`
            },
            { role: 'user', content: prompt }
          ]
        })
      }
    )

    if (!aiRes.ok) {
      const errData = await aiRes.json()
      console.error('OpenRouter error:', errData)
      throw new Error(errData?.error?.message || 'AI service error')
    }

    const aiData = await aiRes.json()
    const output = aiData?.choices?.[0]?.message?.content || 'No response generated'

    const updatedCredits = Math.max(meta.credits - 1, 0)
    const title = prompt.slice(0, 60) + (prompt.length > 60 ? '...' : '')
    const createdAt = new Date().toISOString()

    // ✅ log before saving
    console.log('Saving to history...', {
      dbId: process.env.DB_ID,
      historyCollection: process.env.HISTORY_COLLECTION
    })

    await Promise.all([
      db.updateDocument(
        process.env.DB_ID,
        process.env.USER_META_COLLECTION,
        meta.$id,
        { credits: updatedCredits }
      ),
      db.createDocument(
        process.env.DB_ID,
        process.env.HISTORY_COLLECTION,
        ID.unique(),
        { userId: userId, prompt: prompt, output: output, title: title, type: contentType, $createdAt: createdAt }
      )
    ])

    console.log('✅ Done! Credits left:', updatedCredits)

    return res.json({ output, creditsLeft: updatedCredits, plan }, 200, headers)

  } catch (err) {
    console.error('FULL ERROR:', {
      message: err.message,
      code: err.code,
      type: err.type
    })
    return res.json({ error: err.message || 'Server error' }, 500, headers)
  }
}