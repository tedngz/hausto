import { useNavigate } from 'react-router-dom';
import { XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

const SubscriptionCancel = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="text-center max-w-md">
        <XCircle className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Payment Cancelled</h1>
        <p className="text-muted-foreground mb-6">
          No worries! You can upgrade to Premium anytime.
        </p>
        <Button onClick={() => navigate('/')} size="lg">
          Go Home
        </Button>
      </div>
    </div>
  );
};

export default SubscriptionCancel;
