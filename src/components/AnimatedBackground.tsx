const AnimatedBackground = () => {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      {/* Base background */}
      <div className="absolute inset-0 bg-background" />
      
      {/* Primary orange blob - top right */}
      <div 
        className="absolute -top-32 -right-32 w-[600px] h-[600px] rounded-full blur-[100px] opacity-30 animate-blob-float-1"
        style={{
          background: 'radial-gradient(circle, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.3) 50%, transparent 70%)'
        }}
      />
      
      {/* Secondary teal blob - bottom left */}
      <div 
        className="absolute -bottom-32 -left-32 w-[500px] h-[500px] rounded-full blur-[100px] opacity-25 animate-blob-float-2"
        style={{
          background: 'radial-gradient(circle, hsl(180 60% 45%) 0%, hsl(180 60% 45% / 0.3) 50%, transparent 70%)'
        }}
      />
      
      {/* Tertiary accent blob - center */}
      <div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full blur-[120px] opacity-20 animate-blob-pulse"
        style={{
          background: 'radial-gradient(circle, hsl(24 80% 60%) 0%, hsl(24 80% 60% / 0.2) 50%, transparent 70%)'
        }}
      />
      
      {/* Small accent blob - top left */}
      <div 
        className="absolute top-20 left-1/4 w-[300px] h-[300px] rounded-full blur-[80px] opacity-15 animate-blob-float-3"
        style={{
          background: 'radial-gradient(circle, hsl(180 50% 50%) 0%, transparent 70%)'
        }}
      />
      
      {/* Dot grid overlay */}
      <div 
        className="absolute inset-0 opacity-[0.12] dark:opacity-[0.15]"
        style={{
          backgroundImage: 'radial-gradient(circle, hsl(var(--foreground)) 1.5px, transparent 1.5px)',
          backgroundSize: '28px 28px'
        }}
      />
    </div>
  );
};

export default AnimatedBackground;
