import { chromium, BrowserContext, Page } from 'playwright';
import { ScraperResult, Subtitle } from '../types';
import { Decoder } from '../utils/decoder';
import { logger } from '../utils/logger';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

export class M3U8Extractor {

  static async extractFromUrl(url: string, timeoutMs = 20000): Promise<ScraperResult[]> {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080',
      ],
    });

    const found: ScraperResult[] = [];
    const subtitles: Subtitle[] = [];
    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    try {
      const context = await browser.newContext({
        userAgent: ua,
        ignoreHTTPSErrors: true,
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        (window as any).chrome = { runtime: {} };
      });

      const page = await context.newPage();

      page.on('request', (req: any) => {
        const u = req.url();
        if (Decoder.containsM3U8(u)) {
          if (!found.find((f: ScraperResult) => f.url === u)) {
            found.push({ url: u, quality: Decoder.detectQuality(u), isM3U8: true });
            logger.info(`[REQ] ${u.substring(0, 70)}`);
          }
        }
        if (u.includes('.vtt') || u.includes('.srt') || u.includes('subtitle')) {
          M3U8Extractor.addSubtitle(subtitles, u);
        }
      });

      page.on('response', async (res: any) => {
        const u = res.url();
        const ct = res.headers()['content-type'] || '';
        if (Decoder.containsM3U8(u) || ct.includes('application/x-mpegURL') || ct.includes('application/vnd.apple.mpegurl')) {
          if (!found.find((f: ScraperResult) => f.url === u)) {
            found.push({ url: u, quality: Decoder.detectQuality(u), isM3U8: true });
          }
        }
        if (ct.includes('javascript') || ct.includes('json') || ct.includes('text/plain')) {
          try {
            const text = await res.text().catch(() => '');
            if (!text || text.length < 10) return;
            Decoder.decodeAll(text).forEach((url: string) => {
              if (!found.find((f: ScraperResult) => f.url === url)) {
                found.push({ url, quality: Decoder.detectQuality(url), isM3U8: true });
              }
            });
            M3U8Extractor.extractSubtitlesFromText(text, subtitles);
          } catch {}
        }
      });

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
      await page.waitForTimeout(5000);

      if (found.length > 0) {
        await context.close();
        return M3U8Extractor.finalize(found, subtitles);
      }

      const iframeUrls = await M3U8Extractor.getIframeUrls(page);
      if (iframeUrls.length > 0) {
        await Promise.allSettled(
          iframeUrls.map((iUrl: string) => M3U8Extractor.scanIframe(context, iUrl, found, subtitles))
        );
      }

      if (found.length === 0) {
        const html = await page.content().catch(() => '');
        Decoder.decodeAll(html).forEach((u: string) => {
          if (!found.find((f: ScraperResult) => f.url === u)) {
            found.push({ url: u, quality: Decoder.detectQuality(u), isM3U8: true });
          }
        });
      }

      await context.close();
    } catch (err) {
      logger.error(`[Extractor] ${(err as Error).message}`);
    } finally {
      await browser.close();
    }

    return M3U8Extractor.finalize(found, subtitles);
  }

  static async scanIframe(context: BrowserContext, url: string, found: ScraperResult[], subtitles: Subtitle[]): Promise<void> {
    const page = await context.newPage();
    page.on('request', (req: any) => {
      const u = req.url();
      if (Decoder.containsM3U8(u) && !found.find((f: ScraperResult) => f.url === u)) {
        found.push({ url: u, quality: Decoder.detectQuality(u), isM3U8: true });
      }
    });
    page.on('response', async (res: any) => {
      const ct = res.headers()['content-type'] || '';
      if (ct.includes('javascript') || ct.includes('json')) {
        try {
          const text = await res.text().catch(() => '');
          Decoder.decodeAll(text).forEach((u: string) => {
            if (!found.find((f: ScraperResult) => f.url === u)) {
              found.push({ url: u, quality: Decoder.detectQuality(u), isM3U8: true });
            }
          });
        } catch {}
      }
    });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await page.waitForTimeout(3000);
    } catch {}
    await page.close();
  }

  static extractSubtitlesFromText(text: string, subtitles: Subtitle[]): void {
    const pattern = /['"](https?:\/\/[^'"]+\.(?:vtt|srt|ass))['"]/g;
    for (const m of text.matchAll(pattern)) {
      M3U8Extractor.addSubtitle(subtitles, m[1]);
    }
  }

  static addSubtitle(subtitles: Subtitle[], url: string, label?: string): void {
    if (subtitles.find((s: Subtitle) => s.url === url)) return;
    const format: 'vtt' | 'srt' | 'ass' = url.includes('.srt') ? 'srt' : url.includes('.ass') ? 'ass' : 'vtt';
    const lang = M3U8Extractor.detectLang(label || url);
    subtitles.push({ url, lang, label: label || lang, format });
  }

  static detectLang(text: string): string {
    const t = text.toLowerCase();
    if (t.includes('arabic') || t.includes('ara') || t.includes('.ar')) return 'ar';
    if (t.includes('english') || t.includes('eng') || t.includes('.en')) return 'en';
    if (t.includes('french') || t.includes('fre') || t.includes('.fr')) return 'fr';
    if (t.includes('spanish') || t.includes('spa') || t.includes('.es')) return 'es';
    if (t.includes('turkish') || t.includes('tur') || t.includes('.tr')) return 'tr';
    if (t.includes('german') || t.includes('deu') || t.includes('.de')) return 'de';
    if (t.includes('italian') || t.includes('ita') || t.includes('.it')) return 'it';
    if (t.includes('russian') || t.includes('rus') || t.includes('.ru')) return 'ru';
    if (t.includes('japanese') || t.includes('jpn') || t.includes('.ja')) return 'ja';
    if (t.includes('korean') || t.includes('kor') || t.includes('.ko')) return 'ko';
    return 'unknown';
  }

  static async getIframeUrls(page: Page): Promise<string[]> {
    try {
      return await page.evaluate(() =>
        Array.from(document.querySelectorAll('iframe[src]'))
          .map((f) => (f as HTMLIFrameElement).src)
          .filter((s) => s?.startsWith('http'))
      );
    } catch { return []; }
  }

  static finalize(found: ScraperResult[], subtitles: Subtitle[]): ScraperResult[] {
    const seen = new Set<string>();
    return found
      .filter((f: ScraperResult) => {
        if (seen.has(f.url)) return false;
        seen.add(f.url);
        return true;
      })
      .map((f: ScraperResult) => ({ ...f, subtitles }));
  }
}
