// Candidates the crawler refused to store, newest first, with the reason
// scrape-marketplace logged (too few photos, no interior shots, a multi-unit
// ad, AI renders). The run-level share of each reason is in Crawl activity;
// this is where to look at the actual ads.

import { useQuery } from '@tanstack/react-query';
import { RefreshCw, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { timeAgo } from '@/lib/crawlAdmin';

export const CrawlerRejectionsPanel = () => {
  const { data: rejections, refetch } = useQuery({
    queryKey: ['crawler-rejections'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crawler_rejections')
        .select('id, source, source_url, reason, sample_images, rejected_at')
        .order('rejected_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 60000,
  });

  return (
    <Card>
      <CardHeader className="px-4 md:px-6">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base md:text-lg">
              <XCircle className="h-5 w-5" />
              Crawler rejections
              {rejections && rejections.length > 0 && <Badge variant="outline" className="text-xs">{rejections.length}</Badge>}
            </CardTitle>
            <CardDescription className="text-xs md:text-sm">
              Ads the crawler refused to store, and why - too few photos, no interior shots, multi-unit ads, renders.
            </CardDescription>
          </div>
          <Button size="sm" variant="ghost" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 md:px-6">
        {!rejections || rejections.length === 0 ? (
          <p className="text-xs text-muted-foreground">No rejections logged yet.</p>
        ) : (
          <div className="divide-y border rounded-md max-h-[420px] overflow-y-auto">
            {rejections.map((r) => (
              <div key={r.id} className="p-2.5 text-xs space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="text-[10px]">{r.source}</Badge>
                    <Badge variant="destructive" className="text-[10px] max-w-[16rem] truncate" title={r.reason}>{r.reason}</Badge>
                  </div>
                  <span className="text-muted-foreground whitespace-nowrap">{timeAgo(r.rejected_at)}</span>
                </div>
                <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="block truncate text-primary hover:underline">
                  {r.source_url}
                </a>
                {Array.isArray(r.sample_images) && r.sample_images.length > 0 && (
                  <div className="flex gap-1 overflow-x-auto pt-1">
                    {(r.sample_images as string[]).slice(0, 4).map((img, i) => (
                      <img key={i} src={img} alt="" className="h-12 w-16 object-cover rounded border flex-shrink-0" loading="lazy" />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
