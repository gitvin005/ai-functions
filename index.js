import fetch from 'node-fetch'
import { Client, Databases, Query } from 'appwrite'

export default async ({ req, res }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY)

  const db = new Databases(client)

  const { userId, prompt } = JSON.parse(req.body)

  const metaRes = await db.listDocuments(
    process.env.DB_ID,
    process.env.USER_META_COLLECTION,
    [Query.equal('userId', userId)]
  )

  let meta = metaRes.documents[0]

  // reset credits
  const today = new Date().toDateString()
  const last = new Date(meta.lastReset).toDateString()

  if (today !== last) {
    const newCredits = meta.plan === 'pro' ? 100 : 10

    meta = await db.updateDocument(
      process.env.DB_ID,
      process.env.USER_META_COLLECTION,
      meta.$id,
      {
        credits: newCredits,
        lastReset: new Date().toISOString()
      }
    )
  }

  if (meta.credits <= 0) {
    return res.json({ error: 'Limit reached' })
  }

  const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }]
    })
  })

  const data = await aiRes.json()

  const output = data.choices?.[0]?.message?.content || ''

  await db.updateDocument(
    process.env.DB_ID,
    process.env.USER_META_COLLECTION,
    meta.$id,
    {
      credits: meta.credits - 1
    }
  )

  return res.json({
    output,
    creditsLeft: meta.credits - 1
  })
}