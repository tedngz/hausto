
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Apartment } from '@/types';
import { UserProfile } from '@/components/LoginModal';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface ContactModalProps {
  apartment: Apartment;
  userProfile?: UserProfile;
  onClose: () => void;
}

export const ContactModal = ({ apartment, userProfile, onClose }: ContactModalProps) => {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    name: userProfile?.name || '',
    email: userProfile?.email || '',
    phone: userProfile?.phone || '',
    message: `Hi ${apartment.realtor.name}, I'm interested in viewing "${apartment.title}" in ${apartment.location}. Could we schedule a viewing?`
  });
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user?.id) {
      toast({
        title: "Authentication required",
        description: "Please log in to send a message.",
        variant: "destructive",
      });
      return;
    }
    
    try {
      console.log('Starting conversation between user:', user.id, 'and realtor:', apartment.realtor.id, 'for property:', apartment.id);
      
      // Get or create conversation using upsert
      const { data: existingConv } = await supabase
        .from('match_conversations')
        .select('id')
        .eq('realtor_id', apartment.realtor.id)
        .eq('renter_id', user.id)
        .maybeSingle();

      let conversationId = existingConv?.id;
      
      // Create conversation if it doesn't exist
      if (!conversationId) {
        const { data: newConv, error: convError } = await supabase
          .from('match_conversations')
          .upsert(
            {
              realtor_id: apartment.realtor.id,
              renter_id: user.id,
              is_active: true,
            },
            { onConflict: 'renter_id,realtor_id' }
          )
          .select('id')
          .single();

        if (convError) {
          console.error('Error creating conversation:', convError);
          throw convError;
        }
        
        conversationId = newConv.id;
      }

      if (!conversationId) {
        throw new Error('Failed to create or find conversation');
      }

      // Check if this property match already exists
      const { data: existingMatch } = await supabase
        .from('property_matches')
        .select('id')
        .eq('property_id', apartment.id)
        .eq('realtor_id', apartment.realtor.id)
        .eq('renter_id', user.id)
        .maybeSingle();

      // Create property match if it doesn't exist
      if (!existingMatch) {
        const { error: matchError } = await supabase
          .from('property_matches')
          .upsert({
            property_id: apartment.id,
            realtor_id: apartment.realtor.id,
            renter_id: user.id
          }, { onConflict: 'renter_id,realtor_id,property_id' })
          .select()
          .maybeSingle();

        if (matchError && matchError.code !== '23505') { // Ignore duplicate key error
          console.error('Error creating property match:', matchError);
        }
      }

      // Validate and send the initial message
      const { messageSchema } = await import('@/lib/validation');
      const validatedMessage = messageSchema.parse({
        content: formData.message,
        conversation_id: conversationId,
        receiver_id: apartment.realtor.id,
      });

      const { data: messageData, error: messageError } = await supabase
        .from('direct_messages')
        .insert({
          conversation_id: conversationId,
          sender_id: user.id,
          receiver_id: apartment.realtor.id,
          content: validatedMessage.content
        })
        .select()
        .single();

      if (messageError) {
        console.error('Error sending message:', messageError);
        throw messageError;
      }

      // If this is a new property match, add a system message
      if (!existingMatch) {
        await supabase
          .from('direct_messages')
          .insert({
            conversation_id: conversationId,
            sender_id: user.id,
            receiver_id: apartment.realtor.id,
            content: `🎉 New property match: "${apartment.title}" in ${apartment.location}`,
            metadata: { 
              type: 'system',
              property_id: apartment.id,
              property_title: apartment.title,
              property_location: apartment.location
            }
          });
      }

      // Update conversation with latest message
      await supabase
        .from('match_conversations')
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: formData.message.substring(0, 100)
        })
        .eq('id', conversationId);

      toast({
        title: "Message sent!",
        description: `Your interest in "${apartment.title}" has been sent to the property owner.`,
        duration: 3000,
      });
      
      onClose();
    } catch (error) {
      console.error('Error in conversation initiation:', error);
      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <span>Contact Realtor</span>
          </DialogTitle>
        </DialogHeader>
        
        <div className="mb-4">
          <div className="flex items-center space-x-3 mb-3">
            <img 
              src={apartment.images[0]} 
              alt={apartment.title}
              className="w-16 h-16 object-cover rounded-lg"
            />
            <div>
              <h4 className="font-semibold">{apartment.title}</h4>
              <p className="text-sm text-gray-600">{apartment.location}</p>
              <p className="text-sm font-medium text-green-600">${apartment.price}/mo</p>
            </div>
          </div>
          
          <div className="bg-gray-50 p-3 rounded-lg">
            <p className="text-sm font-medium">{apartment.realtor.name}</p>
            <p className="text-xs text-gray-600">Licensed Realtor</p>
            <p className="text-xs text-gray-500 mt-1">Contact details will be shared after your message is sent</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="name" className="text-sm">Name</Label>
              <Input
                id="name"
                required
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="phone" className="text-sm">Phone</Label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
              />
            </div>
          </div>
          
          <div>
            <Label htmlFor="email" className="text-sm">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
            />
          </div>
          
          <div>
            <Label htmlFor="message" className="text-sm">Message</Label>
            <Textarea
              id="message"
              rows={4}
              value={formData.message}
              onChange={(e) => setFormData(prev => ({ ...prev, message: e.target.value }))}
            />
          </div>
          
          <div className="flex space-x-3">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button 
              type="submit" 
              className="flex-1 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600"
            >
              Send Message
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
