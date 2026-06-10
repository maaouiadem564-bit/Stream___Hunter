import { StreamRequest, StreamResult, StreamSource, Subtitle } from '../types';
import { getSourcesForType, Source } from './sources';
import { M3U8Extractor } from '../extractors/m3u8Extractor';
import { healthTracker } from '../health/sourceHealth';
import { logger } from '../utils/logger';
import NodeCache from 'node-cache';

const cache = new NodeCache({
  stdTTL: parseInt(process.env.CACHE_TTL_MINUTES || '30') * 60,
  checkperiod: 120,
});

export class StreamHunter {

  static async hunt(req: StreamRequest): Promise<StreamResult> {
    const startTime = Date.now();
    const cacheKey = `${req.type}-${req.tmdbId}-${req.imdbId}-s${req.season ?? 0}-e${req.episode ?? 0}`;

    const cached = cache.get<StreamResult>(cacheKey);
    if (cached) {
      return { ...cached, cached: true, response_time_ms: Date.now() - startTime };
    }

    const allSources = getSourcesForType(req.type);
    const sources = allSources.filter((s: Source) => !healthTracker.isDead(s.name));
    const activeSources = sources.length > 0 ? sources : allSources;

    const sourceParams = {
      tmdbId: req.tmdbId,
      imdbId: req.imdbId,
      type: req.type,
      season: req.season,
      episode: req.episode,
      title: req.title,
    };

    const priority1 = activeSources.filter((s: Source) => s.priority === 1);
    const priority2 = activeSources.filter((s: Source) => s.priority === 2);
    const priority3 = activeSources.filter((s: Source) => s.priority === 3);

    const allStreams: StreamSource[] = [];
    const allSubtitles: Subtitle[] = [];
    const sourcesTried: string[] = [];
    const sourcesSucceeded: string[] = [];

    for (const group of [priority1, priority2, priority3]) {
      if (group.length === 0) continue;
      if (allStreams.length > 0) break;

      const results = await Promise.allSettled(
        group.map(async (source: Source) => {
          const url = source.buildUrl(sourceParams);
          if (!url) return { source: source.name, streams: [], subtitles: [] };
          const t = Date.now();
          try {
            const extracted = await M3U8Extractor.extractFromUrl(url);
            const ms = Date.now() - t;
            const success = extracted.length > 0;
            healthTracker.record(source.name, success, ms);
            if (success) sourcesSucceeded.push(source.name);
            return {
              source: source.name,
              streams: extracted.map((r: any) => ({ url: r.url, quality: r.quality, isM3U8: r.isM3U8, source: source.name })),
              subtitles: extracted[0]?.subtitles || [],
            };
          } catch (err) {
            healthTracker.record(source.name, false, Date.now() - t);
            logger.error(`[ERROR] ${source.name}: ${(err as Error).message}`);
            return { source: source.name, streams: [], subtitles: [] };
          }
        })
      );

      results.forEach((r: any) => {
        if (r.status === 'fulfilled') {
          sourcesTried.push(r.value.source);
          allStreams.push(...r.value.streams);
          allSubtitles.push(...r.value.subtitles);
        }
      });
    }

    const qualityOrder: Record<string, number> = { '4K': 0, '1080p': 1, '720p': 2, '480p': 3, '360p': 4, 'auto': 5 };
    const dedupedStreams = [...new Map(allStreams.map((s: StreamSource) => [s.url, s])).values()]
      .sort((a: StreamSource, b: StreamSource) => (qualityOrder[a.quality] ?? 6) - (qualityOrder[b.quality] ?? 6));
    const dedupedSubs = [...new Map(allSubtitles.map((s: Subtitle) => [s.url, s])).values()];

    const result: StreamResult = {
      success: dedupedStreams.length > 0,
      tmdbId: req.tmdbId,
      imdbId: req.imdbId,
      type: req.type,
      streams: dedupedStreams,
      subtitles: dedupedSubs,
      cached: false,
      response_time_ms: Date.now() - startTime,
      sources_tried: sourcesTried,
      sources_succeeded: sourcesSucceeded,
      error: dedupedStreams.length === 0 ? 'No m3u8 stream found' : undefined,
    };

    if (result.success) cache.set(cacheKey, result);
    return result;
  }

  static async prewarm(ids: number[]): Promise<void> {
    for (const tmdbId of ids) {
      try {
        await StreamHunter.hunt({ tmdbId, type: 'movie' });
      } catch {}
      await new Promise((r: any) => setTimeout(r, 2000));
    }
  }
}
