import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Heart, MessageCircle, Share, Plus, Image as ImageIcon, MoreHorizontal, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

interface Post {
  id: string;
  content: string;
  images: string[];
  created_at: string;
  likes_count: number;
  comments_count: number;
  user_id: string;
  user_name?: string;
  user_liked?: boolean;
}

export const SocialFeed = () => {
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [newPost, setNewPost] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [showCreatePost, setShowCreatePost] = useState(false);

  useEffect(() => {
    fetchPosts();
  }, []);

  const fetchPosts = async () => {
    try {
      // Fetch posts without likes data
      const { data: postsData, error: postsError } = await supabase
        .from('posts')
        .select('*')
        .order('created_at', { ascending: false });

      if (postsError) throw postsError;

      // Fetch user profiles for the posts (secure function that requires authentication)
      const userIds = [...new Set(postsData?.map(post => post.user_id) || [])];
      const { data: profilesData, error: profilesError } = await supabase
        .rpc('get_post_authors_profiles', { user_ids: userIds });

      if (profilesError) throw profilesError;

      // For each post, get like count and user's like status using secure functions
      const postsWithDetails = await Promise.all(
        (postsData || []).map(async (post) => {
          const [likeCountResult, userLikedResult] = await Promise.all([
            supabase.rpc('get_post_like_count', { post_uuid: post.id }),
            user ? supabase.rpc('user_liked_post', { post_uuid: post.id }) : Promise.resolve({ data: false })
          ]);

          return {
            ...post,
            likes_count: likeCountResult.data || 0,
            user_liked: userLikedResult.data || false,
            user_name: profilesData?.find(profile => profile.id === post.user_id)?.name || 'Anonymous User'
          };
        })
      );

      setPosts(postsWithDetails);
    } catch (error) {
      console.error('Error fetching posts:', error);
      toast.error('Failed to load posts');
    }
  };

  const createPost = async () => {
    if (!newPost.trim() || !user) return;

    setIsPosting(true);
    try {
      const { error } = await supabase
        .from('posts')
        .insert({
          content: newPost.trim(),
          user_id: user.id,
        });

      if (error) throw error;

      setNewPost('');
      setShowCreatePost(false);
      toast.success('Post shared!');
      fetchPosts();
    } catch (error) {
      console.error('Error creating post:', error);
      toast.error('Failed to create post');
    } finally {
      setIsPosting(false);
    }
  };

  const toggleLike = async (postId: string) => {
    if (!user) return;

    const post = posts.find(p => p.id === postId);
    const hasLiked = post?.user_liked || false;

    try {
      if (hasLiked) {
        await supabase
          .from('post_likes')
          .delete()
          .eq('post_id', postId)
          .eq('user_id', user.id);
      } else {
        await supabase
          .from('post_likes')
          .insert({
            post_id: postId,
            user_id: user.id,
          });
      }

      fetchPosts();
    } catch (error) {
      console.error('Error toggling like:', error);
      toast.error('Failed to update like');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-md mx-auto">
          <h1 className="text-xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent text-center">
            Hausto Feed
          </h1>
        </div>
      </div>

      <div className="max-w-md mx-auto pb-20">
        {/* Create Post Modal */}
        {showCreatePost && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] overflow-hidden animate-fade-in animate-scale-in">
              <div className="flex items-center justify-between p-4 border-b">
                <Button variant="ghost" onClick={() => setShowCreatePost(false)}>
                  Cancel
                </Button>
                <h3 className="font-semibold">New Post</h3>
                <Button 
                  onClick={createPost}
                  disabled={!newPost.trim() || isPosting}
                  size="sm"
                  className="bg-blue-500 hover:bg-blue-600 text-white border-0"
                >
                  {isPosting ? 'Sharing...' : 'Share'}
                </Button>
              </div>
              <div className="p-4">
                <div className="flex gap-3 mb-4">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src="" />
                    <AvatarFallback className="bg-gradient-to-br from-purple-500 to-pink-500 text-white">
                      {user?.user_metadata?.name?.charAt(0)?.toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{user?.user_metadata?.name || 'You'}</p>
                  </div>
                </div>
                <Textarea
                  placeholder="What's happening in your property world? Share updates, tips, or connect with your community..."
                  value={newPost}
                  onChange={(e) => setNewPost(e.target.value)}
                  className="min-h-[120px] resize-none border-0 shadow-none text-base placeholder:text-gray-400 focus-visible:ring-0"
                  autoFocus
                />
                 <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <Button variant="ghost" size="sm" className="text-blue-500">
                    <ImageIcon className="h-5 w-5 mr-2" />
                    Photo
                  </Button>
                  <span className="text-xs text-gray-500">{newPost.length}/280</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Posts Feed */}
        <div className="space-y-0">
          {posts.length === 0 ? (
            <div className="bg-white mx-4 mt-4 rounded-2xl p-8 text-center animate-fade-in">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <MessageCircle className="h-8 w-8 text-gray-400" />
              </div>
              <h3 className="font-semibold text-lg mb-2">No posts yet</h3>
              <p className="text-gray-600 text-sm mb-4">Be the first to share something!</p>
              <Button 
                onClick={() => setShowCreatePost(true)}
                className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white border-0"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Post
              </Button>
            </div>
          ) : (
            posts.map((post, index) => {
              const hasLiked = post.user_liked || false;
              
              return (
                <div key={post.id} className={`bg-white ${index === 0 ? 'mt-4' : ''} animate-fade-in hover-scale`}>
                  {/* Post Header */}
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src="" />
                        <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-500 text-white">
                          {post.user_name?.charAt(0)?.toUpperCase() || 'U'}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-semibold text-sm">{post.user_name || 'Anonymous User'}</p>
                        <p className="text-xs text-gray-500">
                          {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Post Content */}
                  {post.content && (
                    <div className="px-4 pb-3">
                      <p className="text-sm leading-relaxed">{post.content}</p>
                    </div>
                  )}

                  {/* Post Images */}
                  {post.images && post.images.length > 0 && (
                    <div className="aspect-square bg-gray-100">
                      {post.images.length === 1 ? (
                        <img
                          src={post.images[0]}
                          alt="Post content"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="grid grid-cols-2 gap-0.5 h-full">
                          {post.images.slice(0, 4).map((image, imgIndex) => (
                            <div key={imgIndex} className="relative">
                              <img
                                src={image}
                                alt={`Post content ${imgIndex + 1}`}
                                className="w-full h-full object-cover"
                              />
                              {imgIndex === 3 && post.images.length > 4 && (
                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                  <span className="text-white font-semibold">
                                    +{post.images.length - 4}
                                  </span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Post Actions */}
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-4">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleLike(post.id)}
                          className="h-8 w-8 p-0 hover:bg-transparent transition-transform hover:scale-110"
                        >
                          <Heart 
                            className={`h-6 w-6 transition-colors ${
                              hasLiked 
                                ? 'fill-red-500 text-red-500' 
                                : 'text-gray-900 hover:text-gray-600'
                            }`} 
                          />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-transparent transition-transform hover:scale-110">
                          <MessageCircle className="h-6 w-6 text-gray-900 hover:text-gray-600" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-transparent transition-transform hover:scale-110">
                          <Send className="h-6 w-6 text-gray-900 hover:text-gray-600" />
                        </Button>
                      </div>
                    </div>

                    {/* Like Count */}
                    {(post.likes_count || 0) > 0 && (
                      <p className="font-semibold text-sm mb-2">
                        {post.likes_count} {post.likes_count === 1 ? 'like' : 'likes'}
                      </p>
                    )}

                     {/* Add Comment */}
                    <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-100">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src="" />
                        <AvatarFallback className="bg-gray-300 text-xs">
                          {user?.user_metadata?.name?.charAt(0)?.toUpperCase() || 'U'}
                        </AvatarFallback>
                      </Avatar>
                      <input
                        type="text"
                        placeholder="Add a comment..."
                        className="flex-1 text-sm placeholder:text-gray-400 border-0 bg-transparent focus:outline-none"
                      />
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                        <Send className="h-3 w-3 text-blue-500" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Floating Action Button */}
      <Button
        onClick={() => setShowCreatePost(true)}
        className="fixed bottom-20 right-4 w-14 h-14 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white shadow-lg border-0 z-40"
      >
        <Plus className="h-6 w-6" />
      </Button>
    </div>
  );
};