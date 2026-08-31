export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_search_results: {
        Row: {
          created_at: string | null
          id: string
          match_reason: string | null
          match_score: number | null
          property_id: string
          search_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          match_reason?: string | null
          match_score?: number | null
          property_id: string
          search_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          match_reason?: string | null
          match_score?: number | null
          property_id?: string
          search_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_search_results_search_id_fkey"
            columns: ["search_id"]
            isOneToOne: false
            referencedRelation: "ai_searches"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_searches: {
        Row: {
          conversation_id: string
          created_at: string | null
          id: string
          query: string
          summary: string | null
          total_matches: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string | null
          id?: string
          query: string
          summary?: string | null
          total_matches?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string | null
          id?: string
          query?: string
          summary?: string | null
          total_matches?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_ai_searches_conversation"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      anonymous_chat_attempts: {
        Row: {
          attempt_count: number
          created_at: string
          id: string
          ip_address: unknown
          last_attempt_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          id?: string
          ip_address: unknown
          last_attempt_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          id?: string
          ip_address?: unknown
          last_attempt_at?: string
        }
        Relationships: []
      }
      chat_conversations: {
        Row: {
          created_at: string
          id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          metadata: Json | null
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          metadata?: Json | null
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      complex_inquiries: {
        Row: {
          additional_notes: string | null
          admin_notes: string | null
          bedrooms_needed: number
          budget_usd_max: number
          budget_usd_min: number
          complex_id: string
          created_at: string
          email: string
          full_name: string
          handled_at: string | null
          has_pets: boolean
          id: string
          last_inbound_at: string | null
          last_message_at: string | null
          lease_duration_months: number
          notified_at: string | null
          phone: string | null
          status: string
          target_move_in_date: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          additional_notes?: string | null
          admin_notes?: string | null
          bedrooms_needed: number
          budget_usd_max: number
          budget_usd_min: number
          complex_id: string
          created_at?: string
          email: string
          full_name: string
          handled_at?: string | null
          has_pets?: boolean
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          lease_duration_months: number
          notified_at?: string | null
          phone?: string | null
          status?: string
          target_move_in_date: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          additional_notes?: string | null
          admin_notes?: string | null
          bedrooms_needed?: number
          budget_usd_max?: number
          budget_usd_min?: number
          complex_id?: string
          created_at?: string
          email?: string
          full_name?: string
          handled_at?: string | null
          has_pets?: boolean
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          lease_duration_months?: number
          notified_at?: string | null
          phone?: string | null
          status?: string
          target_move_in_date?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "complex_inquiries_complex_id_fkey"
            columns: ["complex_id"]
            isOneToOne: false
            referencedRelation: "complexes"
            referencedColumns: ["id"]
          },
        ]
      }
      complex_inquiry_messages: {
        Row: {
          body: string
          created_at: string
          direction: string
          from_email: string
          id: string
          in_reply_to: string | null
          inquiry_id: string
          provider_message_id: string | null
          source: string
          subject: string | null
          to_emails: string[]
        }
        Insert: {
          body: string
          created_at?: string
          direction: string
          from_email: string
          id?: string
          in_reply_to?: string | null
          inquiry_id: string
          provider_message_id?: string | null
          source?: string
          subject?: string | null
          to_emails?: string[]
        }
        Update: {
          body?: string
          created_at?: string
          direction?: string
          from_email?: string
          id?: string
          in_reply_to?: string | null
          inquiry_id?: string
          provider_message_id?: string | null
          source?: string
          subject?: string | null
          to_emails?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "complex_inquiry_messages_inquiry_id_fkey"
            columns: ["inquiry_id"]
            isOneToOne: false
            referencedRelation: "complex_inquiries"
            referencedColumns: ["id"]
          },
        ]
      }
      complexes: {
        Row: {
          aliases: string[]
          amenities: string[] | null
          average_rent_brackets: Json | null
          city: string
          commute_times: Json | null
          created_at: string
          description: string | null
          developer: string | null
          district: string
          district_code: string | null
          gallery: string[] | null
          hero_image: string | null
          id: string
          insider_cons: string[] | null
          insider_pros: string[] | null
          is_published: boolean
          latitude: number | null
          longitude: number | null
          management_company: string | null
          name: string
          pet_policy: string | null
          slug: string
          tagline: string | null
          tags: string[] | null
          updated_at: string
          year_completed: number | null
        }
        Insert: {
          aliases?: string[]
          amenities?: string[] | null
          average_rent_brackets?: Json | null
          city: string
          commute_times?: Json | null
          created_at?: string
          description?: string | null
          developer?: string | null
          district: string
          district_code?: string | null
          gallery?: string[] | null
          hero_image?: string | null
          id?: string
          insider_cons?: string[] | null
          insider_pros?: string[] | null
          is_published?: boolean
          latitude?: number | null
          longitude?: number | null
          management_company?: string | null
          name: string
          pet_policy?: string | null
          slug: string
          tagline?: string | null
          tags?: string[] | null
          updated_at?: string
          year_completed?: number | null
        }
        Update: {
          aliases?: string[]
          amenities?: string[] | null
          average_rent_brackets?: Json | null
          city?: string
          commute_times?: Json | null
          created_at?: string
          description?: string | null
          developer?: string | null
          district?: string
          district_code?: string | null
          gallery?: string[] | null
          hero_image?: string | null
          id?: string
          insider_cons?: string[] | null
          insider_pros?: string[] | null
          is_published?: boolean
          latitude?: number | null
          longitude?: number | null
          management_company?: string | null
          name?: string
          pet_policy?: string | null
          slug?: string
          tagline?: string | null
          tags?: string[] | null
          updated_at?: string
          year_completed?: number | null
        }
        Relationships: []
      }
      concierge_escalations: {
        Row: {
          answered_message_id: string | null
          conversation_id: string
          created_at: string
          id: string
          property_id: string | null
          question: string
          realtor_id: string
          renter_id: string
          source_message_id: string | null
          status: Database["public"]["Enums"]["escalation_status"]
          updated_at: string
        }
        Insert: {
          answered_message_id?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          property_id?: string | null
          question: string
          realtor_id: string
          renter_id: string
          source_message_id?: string | null
          status?: Database["public"]["Enums"]["escalation_status"]
          updated_at?: string
        }
        Update: {
          answered_message_id?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          property_id?: string | null
          question?: string
          realtor_id?: string
          renter_id?: string
          source_message_id?: string | null
          status?: Database["public"]["Enums"]["escalation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "concierge_escalations_answered_message_id_fkey"
            columns: ["answered_message_id"]
            isOneToOne: false
            referencedRelation: "direct_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concierge_escalations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "match_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concierge_escalations_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "direct_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      crawler_rejections: {
        Row: {
          id: string
          reason: string
          rejected_at: string
          sample_images: Json
          source: string
          source_url: string
        }
        Insert: {
          id?: string
          reason: string
          rejected_at?: string
          sample_images?: Json
          source: string
          source_url: string
        }
        Update: {
          id?: string
          reason?: string
          rejected_at?: string
          sample_images?: Json
          source?: string
          source_url?: string
        }
        Relationships: []
      }
      daily_usage: {
        Row: {
          ai_requests: number | null
          created_at: string
          id: string
          properties_matched: number
          properties_viewed: number
          quiz_retakes: number
          updated_at: string
          usage_date: string
          user_id: string
        }
        Insert: {
          ai_requests?: number | null
          created_at?: string
          id?: string
          properties_matched?: number
          properties_viewed?: number
          quiz_retakes?: number
          updated_at?: string
          usage_date?: string
          user_id: string
        }
        Update: {
          ai_requests?: number | null
          created_at?: string
          id?: string
          properties_matched?: number
          properties_viewed?: number
          quiz_retakes?: number
          updated_at?: string
          usage_date?: string
          user_id?: string
        }
        Relationships: []
      }
      declined_properties: {
        Row: {
          created_at: string
          id: string
          property_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          property_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          property_id?: string
          user_id?: string
        }
        Relationships: []
      }
      direct_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          deleted_by: string[] | null
          id: string
          metadata: Json | null
          read_at: string | null
          receiver_id: string
          sender_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          deleted_by?: string[] | null
          id?: string
          metadata?: Json | null
          read_at?: string | null
          receiver_id: string
          sender_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          deleted_by?: string[] | null
          id?: string
          metadata?: Json | null
          read_at?: string | null
          receiver_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "match_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      external_properties: {
        Row: {
          amenities: string[] | null
          canonical_group_id: string | null
          city: string | null
          contact_name: string | null
          contact_phone: string | null
          crawled_at: string | null
          created_at: string | null
          deactivated_at: string | null
          description: string | null
          expires_at: string | null
          external_id: string
          highlights: string[] | null
          id: string
          image_hashes: string[] | null
          image_location_conflict: boolean
          images: string[] | null
          is_active: boolean | null
          is_relist: boolean
          last_verification_reason: string | null
          last_verification_status: string | null
          last_verified_at: string | null
          latitude: number | null
          location: string
          location_normalized: string | null
          longitude: number | null
          phone_extraction_attempts: number
          price: number | null
          price_display: string | null
          raw_data: Json | null
          raw_only: boolean
          rooms: string | null
          size: string | null
          source: string
          source_url: string
          title: string
          updated_at: string | null
          verification_failures: number
          vibe: string | null
          vibe_analysis: Json | null
          vibe_status: string
        }
        Insert: {
          amenities?: string[] | null
          canonical_group_id?: string | null
          city?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          crawled_at?: string | null
          created_at?: string | null
          deactivated_at?: string | null
          description?: string | null
          expires_at?: string | null
          external_id: string
          highlights?: string[] | null
          id?: string
          image_hashes?: string[] | null
          image_location_conflict?: boolean
          images?: string[] | null
          is_active?: boolean | null
          is_relist?: boolean
          last_verification_reason?: string | null
          last_verification_status?: string | null
          last_verified_at?: string | null
          latitude?: number | null
          location: string
          location_normalized?: string | null
          longitude?: number | null
          phone_extraction_attempts?: number
          price?: number | null
          price_display?: string | null
          raw_data?: Json | null
          raw_only?: boolean
          rooms?: string | null
          size?: string | null
          source: string
          source_url: string
          title: string
          updated_at?: string | null
          verification_failures?: number
          vibe?: string | null
          vibe_analysis?: Json | null
          vibe_status?: string
        }
        Update: {
          amenities?: string[] | null
          canonical_group_id?: string | null
          city?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          crawled_at?: string | null
          created_at?: string | null
          deactivated_at?: string | null
          description?: string | null
          expires_at?: string | null
          external_id?: string
          highlights?: string[] | null
          id?: string
          image_hashes?: string[] | null
          image_location_conflict?: boolean
          images?: string[] | null
          is_active?: boolean | null
          is_relist?: boolean
          last_verification_reason?: string | null
          last_verification_status?: string | null
          last_verified_at?: string | null
          latitude?: number | null
          location?: string
          location_normalized?: string | null
          longitude?: number | null
          phone_extraction_attempts?: number
          price?: number | null
          price_display?: string | null
          raw_data?: Json | null
          raw_only?: boolean
          rooms?: string | null
          size?: string | null
          source?: string
          source_url?: string
          title?: string
          updated_at?: string | null
          verification_failures?: number
          vibe?: string | null
          vibe_analysis?: Json | null
          vibe_status?: string
        }
        Relationships: []
      }
      external_property_snapshots: {
        Row: {
          contact_phone_hash: string | null
          content_hash: string
          id: number
          is_active: boolean
          listing_id: string
          observed_at: string
          price: number | null
          rooms: string | null
          size: string | null
          title: string | null
        }
        Insert: {
          contact_phone_hash?: string | null
          content_hash: string
          id?: number
          is_active?: boolean
          listing_id: string
          observed_at?: string
          price?: number | null
          rooms?: string | null
          size?: string | null
          title?: string | null
        }
        Update: {
          contact_phone_hash?: string | null
          content_hash?: string
          id?: number
          is_active?: boolean
          listing_id?: string
          observed_at?: string
          price?: number | null
          rooms?: string | null
          size?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_property_snapshots_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "external_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      fast_track_requests: {
        Row: {
          archived_at: string | null
          conversation_id: string | null
          created_at: string
          id: string
          notes: string | null
          preferred_dates: string[]
          preferred_times: string[]
          property_ids: string[]
          realtor_id: string | null
          renter_id: string
          scheduled_viewings: Json | null
          source: string
          special_requirements: string | null
          status: Database["public"]["Enums"]["fast_track_status"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          preferred_dates: string[]
          preferred_times: string[]
          property_ids?: string[]
          realtor_id?: string | null
          renter_id: string
          scheduled_viewings?: Json | null
          source?: string
          special_requirements?: string | null
          status?: Database["public"]["Enums"]["fast_track_status"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          preferred_dates?: string[]
          preferred_times?: string[]
          property_ids?: string[]
          realtor_id?: string | null
          renter_id?: string
          scheduled_viewings?: Json | null
          source?: string
          special_requirements?: string | null
          status?: Database["public"]["Enums"]["fast_track_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fast_track_requests_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "match_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_groups: {
        Row: {
          city: string | null
          created_at: string
          first_seen_at: string | null
          id: string
          member_count: number
          price_max: number | null
          price_min: number | null
          project_key: string
          representative_id: string | null
          rooms: string | null
          size_sqm: number | null
          total_member_count: number
          updated_at: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          first_seen_at?: string | null
          id?: string
          member_count?: number
          price_max?: number | null
          price_min?: number | null
          project_key: string
          representative_id?: string | null
          rooms?: string | null
          size_sqm?: number | null
          total_member_count?: number
          updated_at?: string
        }
        Update: {
          city?: string | null
          created_at?: string
          first_seen_at?: string | null
          id?: string
          member_count?: number
          price_max?: number | null
          price_min?: number | null
          project_key?: string
          representative_id?: string | null
          rooms?: string | null
          size_sqm?: number | null
          total_member_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      match_conversations: {
        Row: {
          created_at: string
          id: string
          is_active: boolean | null
          last_message_at: string | null
          last_message_preview: string | null
          realtor_id: string
          renter_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_message_at?: string | null
          last_message_preview?: string | null
          realtor_id: string
          renter_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_message_at?: string | null
          last_message_preview?: string | null
          realtor_id?: string
          renter_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      openai_usage_log: {
        Row: {
          completion_tokens: number
          created_at: string
          estimated_usd: number
          fn: string
          id: number
          images: number
          metadata: Json | null
          model: string
          prompt_tokens: number
          total_tokens: number
        }
        Insert: {
          completion_tokens?: number
          created_at?: string
          estimated_usd?: number
          fn: string
          id?: number
          images?: number
          metadata?: Json | null
          model: string
          prompt_tokens?: number
          total_tokens?: number
        }
        Update: {
          completion_tokens?: number
          created_at?: string
          estimated_usd?: number
          fn?: string
          id?: number
          images?: number
          metadata?: Json | null
          model?: string
          prompt_tokens?: number
          total_tokens?: number
        }
        Relationships: []
      }
      post_likes: {
        Row: {
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          comments_count: number | null
          content: string
          created_at: string
          id: string
          images: string[] | null
          likes_count: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          comments_count?: number | null
          content: string
          created_at?: string
          id?: string
          images?: string[] | null
          likes_count?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          comments_count?: number | null
          content?: string
          created_at?: string
          id?: string
          images?: string[] | null
          likes_count?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          allow_contact_sharing: boolean | null
          avatar_url: string | null
          bio: string | null
          created_at: string
          email: string
          id: string
          location: string | null
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          allow_contact_sharing?: boolean | null
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          email: string
          id: string
          location?: string | null
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          allow_contact_sharing?: boolean | null
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          email?: string
          id?: string
          location?: string | null
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          amenities: string[] | null
          created_at: string
          description: string | null
          highlights: string[] | null
          id: string
          images: string[] | null
          is_active: boolean
          last_activated_at: string
          latitude: number | null
          location: string
          longitude: number | null
          price: number
          property_source_link: string | null
          property_source_provider_name: string | null
          property_source_provider_phone: string | null
          realtor_id: string
          rooms: string | null
          size: string | null
          title: string
          updated_at: string
          vibe: string | null
          vibe_analysis: Json | null
        }
        Insert: {
          amenities?: string[] | null
          created_at?: string
          description?: string | null
          highlights?: string[] | null
          id?: string
          images?: string[] | null
          is_active?: boolean
          last_activated_at?: string
          latitude?: number | null
          location: string
          longitude?: number | null
          price: number
          property_source_link?: string | null
          property_source_provider_name?: string | null
          property_source_provider_phone?: string | null
          realtor_id: string
          rooms?: string | null
          size?: string | null
          title: string
          updated_at?: string
          vibe?: string | null
          vibe_analysis?: Json | null
        }
        Update: {
          amenities?: string[] | null
          created_at?: string
          description?: string | null
          highlights?: string[] | null
          id?: string
          images?: string[] | null
          is_active?: boolean
          last_activated_at?: string
          latitude?: number | null
          location?: string
          longitude?: number | null
          price?: number
          property_source_link?: string | null
          property_source_provider_name?: string | null
          property_source_provider_phone?: string | null
          realtor_id?: string
          rooms?: string | null
          size?: string | null
          title?: string
          updated_at?: string
          vibe?: string | null
          vibe_analysis?: Json | null
        }
        Relationships: []
      }
      property_matches: {
        Row: {
          created_at: string
          id: string
          property_id: string
          property_type: string
          realtor_id: string
          renter_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          property_id: string
          property_type?: string
          realtor_id: string
          renter_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          property_id?: string
          property_type?: string
          realtor_id?: string
          renter_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      property_translations: {
        Row: {
          created_at: string
          description_translated: string | null
          highlights_translated: string[] | null
          id: string
          location_translated: string | null
          property_id: string
          property_type: string
          target_language: string
          title_translated: string | null
          updated_at: string
          vibe_translated: string | null
        }
        Insert: {
          created_at?: string
          description_translated?: string | null
          highlights_translated?: string[] | null
          id?: string
          location_translated?: string | null
          property_id: string
          property_type?: string
          target_language?: string
          title_translated?: string | null
          updated_at?: string
          vibe_translated?: string | null
        }
        Update: {
          created_at?: string
          description_translated?: string | null
          highlights_translated?: string[] | null
          id?: string
          location_translated?: string | null
          property_id?: string
          property_type?: string
          target_language?: string
          title_translated?: string | null
          updated_at?: string
          vibe_translated?: string | null
        }
        Relationships: []
      }
      realtor_applications: {
        Row: {
          admin_notes: string | null
          bio: string
          city: string
          company: string | null
          created_at: string
          districts: string[]
          email: string
          full_name: string
          id: string
          phone: string
          properties_count: number
          reviewed_at: string | null
          reviewed_by: string | null
          role_type: string
          status: string
          updated_at: string
          user_id: string
          website_or_listing_url: string | null
          years_experience: number
        }
        Insert: {
          admin_notes?: string | null
          bio: string
          city: string
          company?: string | null
          created_at?: string
          districts?: string[]
          email: string
          full_name: string
          id?: string
          phone: string
          properties_count?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          role_type: string
          status?: string
          updated_at?: string
          user_id: string
          website_or_listing_url?: string | null
          years_experience?: number
        }
        Update: {
          admin_notes?: string | null
          bio?: string
          city?: string
          company?: string | null
          created_at?: string
          districts?: string[]
          email?: string
          full_name?: string
          id?: string
          phone?: string
          properties_count?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          role_type?: string
          status?: string
          updated_at?: string
          user_id?: string
          website_or_listing_url?: string | null
          years_experience?: number
        }
        Relationships: []
      }
      security_audit_log: {
        Row: {
          action: string
          created_at: string
          id: string
          ip_address: unknown
          new_values: Json | null
          old_values: Json | null
          record_id: string | null
          table_name: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      subscribers: {
        Row: {
          created_at: string
          email: string
          id: string
          paypal_subscription_id: string | null
          subscribed: boolean
          subscription_end: string | null
          subscription_tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          paypal_subscription_id?: string | null
          subscribed?: boolean
          subscription_end?: string | null
          subscription_tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          paypal_subscription_id?: string | null
          subscribed?: boolean
          subscription_end?: string | null
          subscription_tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      support_conversations: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          activities: string[] | null
          colors: string[] | null
          created_at: string
          id: string
          location: string[] | null
          move_in_date: string | null
          must_haves: string[] | null
          price_range_max: number | null
          price_range_min: number | null
          size: string | null
          styles: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          activities?: string[] | null
          colors?: string[] | null
          created_at?: string
          id?: string
          location?: string[] | null
          move_in_date?: string | null
          must_haves?: string[] | null
          price_range_max?: number | null
          price_range_min?: number | null
          size?: string | null
          styles?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          activities?: string[] | null
          colors?: string[] | null
          created_at?: string
          id?: string
          location?: string[] | null
          move_in_date?: string | null
          must_haves?: string[] | null
          price_range_max?: number | null
          price_range_min?: number | null
          size?: string | null
          styles?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vibe_analysis_queue: {
        Row: {
          attempts: number
          enqueued_at: string
          id: string
          last_error: string | null
          property_id: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          enqueued_at?: string
          id?: string
          last_error?: string | null
          property_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          enqueued_at?: string
          id?: string
          last_error?: string | null
          property_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      passes: {
        Row: {
          amount_usd: number
          expires_at: string
          id: string
          kind: string
          paypal_order_id: string
          purchased_at: string
          renter_id: string
          viewings_included: number
          viewings_used: number
        }
        Insert: {
          amount_usd: number
          expires_at: string
          id?: string
          kind: string
          paypal_order_id: string
          purchased_at?: string
          renter_id: string
          viewings_included: number
          viewings_used?: number
        }
        Update: {
          amount_usd?: number
          expires_at?: string
          id?: string
          kind?: string
          paypal_order_id?: string
          purchased_at?: string
          renter_id?: string
          viewings_included?: number
          viewings_used?: number
        }
        Relationships: []
      }
      viewing_addons: {
        Row: {
          amount_usd: number
          created_at: string
          credits: number
          credits_used: number
          expires_at: string | null
          id: string
          paypal_order_id: string
          renter_id: string
          starts_at: string
        }
        Insert: {
          amount_usd?: number
          created_at?: string
          credits?: number
          credits_used?: number
          expires_at?: string | null
          id?: string
          paypal_order_id: string
          renter_id: string
          starts_at?: string
        }
        Update: {
          amount_usd?: number
          created_at?: string
          credits?: number
          credits_used?: number
          expires_at?: string | null
          id?: string
          paypal_order_id?: string
          renter_id?: string
          starts_at?: string
        }
        Relationships: []
      }
      viewing_trials: {
        Row: {
          renter_id: string
          request_id: string | null
          used_at: string
        }
        Insert: {
          renter_id: string
          request_id?: string | null
          used_at?: string
        }
        Update: {
          renter_id?: string
          request_id?: string | null
          used_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_user_subscription: {
        Args: { user_email: string }
        Returns: undefined
      }
      can_create_fast_track_request: {
        Args: { _user_id: string }
        Returns: boolean
      }
      cleanup_expired_external_properties: { Args: never; Returns: undefined }
      deactivate_expired_properties: { Args: never; Returns: undefined }
      detect_city: { Args: { location_text: string }; Returns: string }
      get_conversation_properties: {
        Args: never
        Returns: {
          conversation_id: string
          images: string[]
          location: string
          match_id: string
          matched_at: string
          price: number
          property_id: string
          property_source_provider_name: string
          property_source_provider_phone: string
          realtor_id: string
          renter_id: string
          title: string
        }[]
      }
      get_external_property_contact: {
        Args: { _property_id: string }
        Returns: {
          contact_name: string
          contact_phone: string
        }[]
      }
      get_external_property_contacts: {
        Args: { _property_ids: string[] }
        Returns: {
          contact_name: string
          contact_phone: string
          id: string
        }[]
      }
      get_matched_public_profiles: {
        Args: { user_ids: string[] }
        Returns: {
          avatar_url: string
          id: string
          name: string
        }[]
      }
      get_openai_usage_summary: {
        Args: { _days?: number }
        Returns: {
          calls: number
          completion_tokens: number
          day: string
          estimated_usd: number
          fn: string
          images: number
          model: string
          prompt_tokens: number
        }[]
      }
      get_post_authors_profiles: {
        Args: { user_ids: string[] }
        Returns: {
          id: string
          name: string
        }[]
      }
      get_post_like_count: { Args: { post_uuid: string }; Returns: number }
      get_profiles_for_admin: {
        Args: { _user_ids: string[] }
        Returns: {
          email: string
          id: string
          name: string
        }[]
      }
      get_property_contacts: {
        Args: { _property_ids: string[] }
        Returns: {
          id: string
          property_source_provider_name: string
          property_source_provider_phone: string
        }[]
      }
      get_realtor_contact_for_renter: {
        Args: { realtor_id: string }
        Returns: {
          bio: string
          email: string
          id: string
          name: string
          phone: string
        }[]
      }
      get_realtor_matched_renter_contact: {
        Args: { renter_id: string }
        Returns: {
          email: string
          id: string
          name: string
          phone: string
        }[]
      }
      get_realtor_public_profile: {
        Args: { realtor_id: string }
        Returns: {
          avatar_url: string
          bio: string
          id: string
          location: string
          name: string
        }[]
      }
      get_realtor_public_profiles: {
        Args: { user_ids: string[] }
        Returns: {
          allow_contact_sharing: boolean
          avatar_url: string
          bio: string
          email: string
          id: string
          location: string
          name: string
          phone: string
        }[]
      }
      get_renter_preferences_for_realtor: {
        Args: { renter_id: string }
        Returns: {
          activities: string[]
          location: string[]
          move_in_date: string
          must_haves: string[]
          price_range_max: number
          price_range_min: number
          size: string
          styles: string[]
        }[]
      }
      get_renter_profile_for_realtor: {
        Args: { renter_id: string }
        Returns: {
          avatar_url: string
          bio: string
          email: string
          id: string
          name: string
          phone: string
        }[]
      }
      get_user_subscription_status: {
        Args: never
        Returns: {
          subscribed: boolean
          subscription_end: string
          subscription_tier: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_property_within_active_period: {
        Args: { activated_at: string }
        Returns: boolean
      }
      normalize_location: { Args: { location_text: string }; Returns: string }
      openai_spend_today: { Args: never; Returns: number }
      prune_orphan_listing_group_refs: { Args: never; Returns: number }
      set_fast_track_archived: {
        Args: { _archived: boolean; _request_id: string }
        Returns: {
          archived_at: string
          id: string
        }[]
      }
      user_liked_post: { Args: { post_uuid: string }; Returns: boolean }
      validate_email: { Args: { email_input: string }; Returns: boolean }
      validate_phone: { Args: { phone_input: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user" | "realtor"
      escalation_status: "pending" | "answered" | "dismissed"
      fast_track_status:
        | "pending"
        | "in_progress"
        | "scheduled"
        | "completed"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user", "realtor"],
      escalation_status: ["pending", "answered", "dismissed"],
      fast_track_status: [
        "pending",
        "in_progress",
        "scheduled",
        "completed",
        "cancelled",
      ],
    },
  },
} as const
