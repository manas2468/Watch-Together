import { Router } from 'express';
import yts from 'yt-search';

export const searchRouter = Router();

searchRouter.get('/search', async (req, res) => {
  const q = req.query.q as string;
  if (!q || !q.trim()) {
    return res.status(400).json({ error: 'Search query is required' });
  }

  try {
    const searchResults = await yts(q.trim());
    const videos = (searchResults.videos || []).slice(0, 15).map((v) => ({
      id: v.videoId,
      title: v.title,
      url: v.url,
      thumbnail: v.thumbnail,
      timestamp: v.timestamp,
      seconds: v.seconds,
      author: v.author?.name || 'Unknown',
      views: v.views,
      ago: v.ago,
    }));

    res.json({ results: videos });
  } catch (err: any) {
    console.error('[Search] YouTube search error:', err);
    res.status(500).json({ error: 'Failed to search YouTube' });
  }
});
