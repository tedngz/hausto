
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
      
      // Check if conversation already exists
      const { data: existingConv, error: checkError } = await supabase
        .from('match_conversations')
        .select('id')
        .eq('realtor_id', apartment.realtor.id)
        .eq('renter_id', user.id)
        .maybeSingle();

      if (checkError) {
        console.error('Error checking existing conversation:', checkError);
        throw checkError;
      }

      let conversationId = existingConv?.id;
      
      // Create new conversation if none exists
      if (!conversationId) {
        console.log('Creating new conversation...');
        const { data: newConv, error: convError } = await supabase
          .from('match_conversations')
          .insert({
            realtor_id: apartment.realtor.id,
            renter_id: user.id,
            is_active: true
          })
          .select()
          .single();

        if (convError) {
          console.error('Error creating conversation:', convError);
          throw convError;
        }
        
        conversationId = newConv.id;
        console.log('Created new conversation with ID:', conversationId);
      } else {
        console.log('Using existing conversation ID:', conversationId);
      }

      if (!conversationId) {
        throw new Error('Failed to create or find conversation');
      }

      // Create property match record for tracking
      await supabase
        .from('property_matches')
        .insert({
          property_id: apartment.id,
          realtor_id: apartment.realtor.id,
          renter_id: user.id
        })
        .select()
        .maybeSingle(); // Don't fail if already exists

      // Send the initial message
      console.log('Sending initial message...');
      const { data: messageData, error: messageError } = await supabase
        .from('direct_messages')
        .insert({
          conversation_id: conversationId,
          sender_id: user.id,
          receiver_id: apartment.realtor.id,
          content: formData.message
        })
        .select()
        .single();

      if (messageError) {
        console.error('Error sending message:', messageError);
        throw messageError;
      }
      
      console.log('Message sent successfully:', messageData);

      // Update conversation with latest message
      console.log('Updating conversation...');
      const { error: updateError } = await supabase
        .from('match_conversations')
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: formData.message.substring(0, 100)
        })
        .eq('id', conversationId);

      if (updateError) {
        console.error('Error updating conversation:', updateError);
        throw updateError;
      }
      
      console.log('Conversation updated successfully');

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
