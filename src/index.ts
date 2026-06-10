import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { StreamHunter } from './scrapers/streamHunter';
import { healthTracker } from './health/sourceHealth';
import { MediaType, StreamRequest } from './types';
import { logger } from './utils/logger';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

app.get('/health', (_: any, res: any) => {
  res.json({ status: 'ok', service: 'StreamHunter', version: '2.0.0', sources_health: healthTracker.getAllHealth() });
});

app.get('/stream', async (req: any, res: any) => {
  try {
    const { tmdbId, imdbId, type, season, episode, title } = req.query;
    if (!type) return res.status(400).json({ success: false, error: 'Missing: type' });
    if (!tmdbId && !imdbId) return res.status(400).json({ success: false, error: 'Missing: tmdbId or imdbId' });
    const validTypes: MediaType[] = ['movie', 'tv', 'anime'];
    if (!validTypes.includes(type as MediaType)) return res.status(400).json({ success: false, error: 'type: movie | tv | anime' });
    const streamReq: StreamRequest = {
      tmdbId: tmdbId ? parseInt(tmdbId as string) : undefined,
      imdbId: imdbId as string | undefined,
      type: type as MediaType,
      season: season ? parseInt(season as string) : undefined,
      episode: episode ? parseInt(episode as string) : undefined,
      title: title as string | undefined,
    };
    const result = await StreamHunter.hunt(streamReq);
    return res.json(result);
  } catch (err) {
    logger.error(`[API] ${(err as Error).message}`);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/sources', (_: any, res: any) => {
  res.json({ health: healthTracker.getAllHealth() });
});

app.listen(PORT, () => {
  logger.info(`🎬 StreamHunter v2 → port ${PORT}`);
  StreamHunter.prewarm([299536, 533535, 550, 27205, 155]).catch(() => {});
});
