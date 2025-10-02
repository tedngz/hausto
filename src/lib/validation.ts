import { z } from 'zod';

// Profile validation schema
export const profileSchema = z.object({
  name: z.string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must be less than 100 characters'),
  email: z.string()
    .trim()
    .email('Invalid email address')
    .max(255, 'Email must be less than 255 characters'),
  phone: z.string()
    .trim()
    .regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format (use E.164 format: +1234567890)')
    .optional()
    .or(z.literal('')),
  bio: z.string()
    .trim()
    .max(500, 'Bio must be less than 500 characters')
    .optional()
    .or(z.literal('')),
  location: z.string()
    .trim()
    .max(200, 'Location must be less than 200 characters')
    .optional()
    .or(z.literal('')),
  avatar_url: z.string().url('Invalid avatar URL').optional().or(z.literal('')),
  allow_contact_sharing: z.boolean().optional(),
});

export type ProfileFormData = z.infer<typeof profileSchema>;

// Property validation schema
export const propertySchema = z.object({
  title: z.string()
    .trim()
    .min(10, 'Title must be at least 10 characters')
    .max(200, 'Title must be less than 200 characters'),
  description: z.string()
    .trim()
    .min(20, 'Description must be at least 20 characters')
    .max(2000, 'Description must be less than 2000 characters')
    .optional()
    .or(z.literal('')),
  location: z.string()
    .trim()
    .min(5, 'Location must be at least 5 characters')
    .max(300, 'Location must be less than 300 characters'),
  price: z.number()
    .positive('Price must be positive')
    .max(1000000000, 'Price is too high'),
  size: z.string()
    .trim()
    .regex(/^\d+\s*m²$/, 'Size must be in format: 100m²')
    .optional()
    .or(z.literal('')),
  vibe: z.string().trim().max(100).optional().or(z.literal('')),
  highlights: z.array(z.string().max(100)).optional(),
  images: z.array(z.string().url('Invalid image URL')).optional(),
  property_source_link: z.string()
    .url('Invalid URL format')
    .max(500, 'URL is too long')
    .optional()
    .or(z.literal('')),
});

export type PropertyFormData = z.infer<typeof propertySchema>;

// Message validation schema
export const messageSchema = z.object({
  content: z.string()
    .trim()
    .min(1, 'Message cannot be empty')
    .max(5000, 'Message must be less than 5000 characters'),
  conversation_id: z.string().uuid('Invalid conversation ID').optional(),
  receiver_id: z.string().uuid('Invalid receiver ID').optional(),
});

export type MessageFormData = z.infer<typeof messageSchema>;

// Chat message validation schema
export const chatMessageSchema = z.object({
  message: z.string()
    .trim()
    .min(1, 'Message cannot be empty')
    .max(10000, 'Message must be less than 10000 characters'),
  conversationId: z.string().uuid('Invalid conversation ID').optional(),
  userType: z.enum(['renter', 'realtor']).optional(),
  preferences: z.record(z.any()).optional(),
  propertyImages: z.array(z.any()).optional(),
});

export type ChatMessageFormData = z.infer<typeof chatMessageSchema>;
