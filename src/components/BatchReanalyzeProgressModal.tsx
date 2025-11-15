import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface PropertyProgress {
  id: string;
  title: string;
  status: 'pending' | 'analyzing' | 'success' | 'failed';
  error?: string;
}

interface BatchReanalyzeProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  properties: PropertyProgress[];
  currentIndex: number;
  totalProperties: number;
}

export const BatchReanalyzeProgressModal = ({
  isOpen,
  onClose,
  properties,
  currentIndex,
  totalProperties
}: BatchReanalyzeProgressModalProps) => {
  const completedCount = properties.filter(p => p.status === 'success' || p.status === 'failed').length;
  const failedProperties = properties.filter(p => p.status === 'failed');
  const successCount = properties.filter(p => p.status === 'success').length;
  const isComplete = completedCount === totalProperties;
  const progress = totalProperties > 0 ? (completedCount / totalProperties) * 100 : 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>
            {isComplete ? 'Re-analysis Complete' : 'Re-analyzing Properties'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>
                {completedCount} of {totalProperties} properties processed
              </span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {isComplete && (
            <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <div>
                  <div className="text-sm font-medium">Successful</div>
                  <div className="text-2xl font-bold text-green-500">{successCount}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-destructive" />
                <div>
                  <div className="text-sm font-medium">Failed</div>
                  <div className="text-2xl font-bold text-destructive">{failedProperties.length}</div>
                </div>
              </div>
            </div>
          )}

          <ScrollArea className="h-[300px] border rounded-md p-4">
            <div className="space-y-2">
              {properties.map((property) => (
                <div
                  key={property.id}
                  className="flex items-start gap-3 p-3 rounded-lg border bg-card"
                >
                  {property.status === 'pending' && (
                    <div className="h-5 w-5 rounded-full border-2 border-muted mt-0.5" />
                  )}
                  {property.status === 'analyzing' && (
                    <Loader2 className="h-5 w-5 animate-spin text-primary mt-0.5" />
                  )}
                  {property.status === 'success' && (
                    <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
                  )}
                  {property.status === 'failed' && (
                    <XCircle className="h-5 w-5 text-destructive mt-0.5" />
                  )}
                  
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{property.title}</div>
                    {property.status === 'analyzing' && (
                      <div className="text-sm text-muted-foreground">Analyzing...</div>
                    )}
                    {property.status === 'success' && (
                      <div className="text-sm text-green-500">Successfully re-analyzed</div>
                    )}
                    {property.status === 'failed' && (
                      <div className="text-sm text-destructive">
                        {property.error || 'Failed to analyze'}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {isComplete && (
            <div className="flex justify-end">
              <Button onClick={onClose}>Close</Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
