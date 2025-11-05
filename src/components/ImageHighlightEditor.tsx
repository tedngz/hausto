import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Wand2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
interface ImageHighlightEditorProps {
  preview: string;
  index: number;
  highlight?: {
    text: string;
    imageIndexes: number[];
  };
  onHighlightUpdate: (index: number, newHighlight: {
    text: string;
    imageIndexes: number[];
  }) => void;
}
export const ImageHighlightEditor = ({
  preview,
  index,
  highlight,
  onHighlightUpdate
}: ImageHighlightEditorProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(highlight?.text || '');
  const [isRegenerating, setIsRegenerating] = useState(false);
  const {
    toast
  } = useToast();
  const handleEdit = () => {
    setIsEditing(true);
    setEditText(highlight?.text || '');
  };
  const handleSave = () => {
    onHighlightUpdate(index, {
      text: editText,
      imageIndexes: [index]
    });
    setIsEditing(false);
  };
  const handleCancel = () => {
    setIsEditing(false);
    setEditText(highlight?.text || '');
  };
  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      const attempt = async () => {
        const { data, error } = await supabase.functions.invoke('analyze-vibe', {
          body: {
            imageUrls: [preview],
            generateContent: false,
            imageIndex: index,
            regenerate: true,
            previousHighlight: highlight?.text
          }
        });
        if (error) throw error;
        const first = data?.analysis?.image_analyses?.[0] ?? {};
        const candidate = first.image_highlight || first.highlight || '';
        return String(candidate).trim();
      };

      // Try up to 2 times to encourage variation
      const prev = (highlight?.text ?? '').trim();
      let next = await attempt();
      if (!next || next.toLowerCase() === prev.toLowerCase()) {
        next = await attempt();
      }

      if (next) {
        onHighlightUpdate(index, {
          text: next,
          imageIndexes: [index]
        });
        toast({
          title: "Highlight Regenerated",
          description: next.toLowerCase() === prev.toLowerCase()
            ? "Generated a similar result. Try again for more variety."
            : "AI has generated a fresh highlight for this image."
        });
      } else {
        toast({
          title: "No Highlight Returned",
          description: "AI didn't detect a clear highlight. Try again or edit manually.",
        });
      }
    } catch (error) {
      console.error('Error regenerating highlight:', error);
      toast({
        title: "Regeneration Failed",
        description: "Could not regenerate highlight. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsRegenerating(false);
    }
  };
  return <div className="space-y-2">
      <div className="relative border rounded-lg overflow-hidden">
        <img src={preview} alt={`Property ${index + 1}`} className="w-full h-24 object-cover" />
        <div className="absolute top-1 left-1">
          <Badge variant="secondary" className="text-xs">
            {index + 1}
          </Badge>
        </div>
      </div>
      
      <div className="space-y-1">
        {isEditing ? <div className="space-y-1">
            <Input value={editText} onChange={e => setEditText(e.target.value)} className="text-xs h-8" placeholder="Enter highlight..." />
            <div className="flex gap-1">
              <Button size="sm" onClick={handleSave} className="h-6 px-2 text-xs">
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={handleCancel} className="h-6 px-2 text-xs">
                Cancel
              </Button>
            </div>
          </div> : <div className="space-y-1">
            <div className="text-xs min-h-[2rem] text-orange-500">
              {highlight?.text}
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={handleEdit} className="h-6 px-2 text-xs">
                Edit
              </Button>
              <Button size="sm" variant="outline" onClick={handleRegenerate} disabled={isRegenerating} className="h-6 px-2 text-xs">
                {isRegenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
              </Button>
            </div>
          </div>}
      </div>
    </div>;
};