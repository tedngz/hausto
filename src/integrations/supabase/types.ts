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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      account_digest_opt_ins: {
        Row: {
          opted_in_at: string
          user_id: string
        }
        Insert: {
          opted_in_at?: string
          user_id: string
        }
        Update: {
          opted_in_at?: string
          user_id?: string
        }
        Relationships: []
      }
      account_link_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          renter_id: string | null
          used_at: string | null
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          expires_at: string
          renter_id?: string | null
          used_at?: string | null
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          renter_id?: string | null
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_link_codes_renter_id_fkey"
            columns: ["renter_id"]
            isOneToOne: false
            referencedRelation: "renters"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_operator_controls: {
        Row: {
          gate_override: string[]
          id: string
          last_run_at: string | null
          last_state: Json | null
          note: string | null
          paused: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          gate_override?: string[]
          id?: string
          last_run_at?: string | null
          last_state?: Json | null
          note?: string | null
          paused?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          gate_override?: string[]
          id?: string
          last_run_at?: string | null
          last_state?: Json | null
          note?: string | null
          paused?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
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
      alert_items: {
        Row: {
          created_at: string
          detail_sent_at: string | null
          id: string
          listing_id: string
          message_id: string
          renter_id: string
          source: string
          watch_id: string | null
        }
        Insert: {
          created_at?: string
          detail_sent_at?: string | null
          id?: string
          listing_id: string
          message_id: string
          renter_id: string
          source: string
          watch_id?: string | null
        }
        Update: {
          created_at?: string
          detail_sent_at?: string | null
          id?: string
          listing_id?: string
          message_id?: string
          renter_id?: string
          source?: string
          watch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_items_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "external_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_items_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_items_renter_id_fkey"
            columns: ["renter_id"]
            isOneToOne: false
            referencedRelation: "renters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_items_watch_id_fkey"
            columns: ["watch_id"]
            isOneToOne: false
            referencedRelation: "complex_watches"
            referencedColumns: ["id"]
          },
        ]
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
      complex_agents: {
        Row: {
          added_by: string
          complex_id: string
          created_at: string
          note: string | null
          realtor_id: string
          source: string
        }
        Insert: {
          added_by: string
          complex_id: string
          created_at?: string
          note?: string | null
          realtor_id: string
          source: string
        }
        Update: {
          added_by?: string
          complex_id?: string
          created_at?: string
          note?: string | null
          realtor_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "complex_agents_complex_id_fkey"
            columns: ["complex_id"]
            isOneToOne: false
            referencedRelation: "complexes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complex_agents_realtor_id_fkey"
            columns: ["realtor_id"]
            isOneToOne: false
            referencedRelation: "realtors"
            referencedColumns: ["id"]
          },
        ]
      }
      complex_inquiries: {
        Row: {
          additional_notes: string | null
          admin_notes: string | null
          area_district_codes: string[] | null
          area_label: string | null
          bedrooms_needed: number
          budget_max_vnd: number | null
          budget_usd_max: number | null
          budget_usd_min: number | null
          channel: string
          complex_id: string | null
          created_at: string
          email: string | null
          full_name: string
          handled_at: string | null
          has_pets: boolean
          id: string
          last_inbound_at: string | null
          last_message_at: string | null
          lease_duration_months: number
          notified_at: string | null
          phone: string | null
          renter_id: string | null
          status: string
          target_move_in_date: string
          updated_at: string
          user_id: string | null
          watch_id: string | null
          whatsapp_confirmed_at: string | null
        }
        Insert: {
          additional_notes?: string | null
          admin_notes?: string | null
          area_district_codes?: string[] | null
          area_label?: string | null
          bedrooms_needed: number
          budget_max_vnd?: number | null
          budget_usd_max?: number | null
          budget_usd_min?: number | null
          channel: string
          complex_id?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          handled_at?: string | null
          has_pets?: boolean
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          lease_duration_months: number
          notified_at?: string | null
          phone?: string | null
          renter_id?: string | null
          status?: string
          target_move_in_date: string
          updated_at?: string
          user_id?: string | null
          watch_id?: string | null
          whatsapp_confirmed_at?: string | null
        }
        Update: {
          additional_notes?: string | null
          admin_notes?: string | null
          area_district_codes?: string[] | null
          area_label?: string | null
          bedrooms_needed?: number
          budget_max_vnd?: number | null
          budget_usd_max?: number | null
          budget_usd_min?: number | null
          channel?: string
          complex_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          handled_at?: string | null
          has_pets?: boolean
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          lease_duration_months?: number
          notified_at?: string | null
          phone?: string | null
          renter_id?: string | null
          status?: string
          target_move_in_date?: string
          updated_at?: string
          user_id?: string | null
          watch_id?: string | null
          whatsapp_confirmed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "complex_inquiries_complex_id_fkey"
            columns: ["complex_id"]
            isOneToOne: false
            referencedRelation: "complexes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complex_inquiries_renter_id_fkey"
            columns: ["renter_id"]
            isOneToOne: false
            referencedRelation: "renters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complex_inquiries_watch_id_fkey"
            columns: ["watch_id"]
            isOneToOne: false
            referencedRelation: "complex_watches"
            referencedColumns: ["id"]
          },
        ]
      }
      complex_inquiry_messages: {
        Row: {
          body: string
          channel: string
          created_at: string
          direction: string
          from_email: string | null
          id: string
          in_reply_to: string | null
          inquiry_id: string
          provider_message_id: string | null
          source: string
          subject: string | null
          to_emails: string[]
          whatsapp_message_id: string | null
        }
        Insert: {
          body: string
          channel?: string
          created_at?: string
          direction: string
          from_email?: string | null
          id?: string
          in_reply_to?: string | null
          inquiry_id: string
          provider_message_id?: string | null
          source?: string
          subject?: string | null
          to_emails?: string[]
          whatsapp_message_id?: string | null
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          direction?: string
          from_email?: string | null
          id?: string
          in_reply_to?: string | null
          inquiry_id?: string
          provider_message_id?: string | null
          source?: string
          subject?: string | null
          to_emails?: string[]
          whatsapp_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "complex_inquiry_messages_inquiry_id_fkey"
            columns: ["inquiry_id"]
            isOneToOne: false
            referencedRelation: "complex_inquiries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complex_inquiry_messages_whatsapp_message_id_fkey"
            columns: ["whatsapp_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      complex_watches: {
        Row: {
          area_district_codes: string[] | null
          area_label: string | null
          bedrooms: number | null
          budget_max_vnd: number | null
          code: string
          complex_id: string | null
          confirmed_at: string | null
          created_at: string
          expires_at: string
          id: string
          move_in_by: string | null
          renter_id: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          area_district_codes?: string[] | null
          area_label?: string | null
          bedrooms?: number | null
          budget_max_vnd?: number | null
          code: string
          complex_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          move_in_by?: string | null
          renter_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          area_district_codes?: string[] | null
          area_label?: string | null
          bedrooms?: number | null
          budget_max_vnd?: number | null
          code?: string
          complex_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          move_in_by?: string | null
          renter_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "complex_watches_complex_id_fkey"
            columns: ["complex_id"]
            isOneToOne: false
            referencedRelation: "complexes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complex_watches_renter_id_fkey"
            columns: ["renter_id"]
            isOneToOne: false
            referencedRelation: "renters"
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
          conversation_id: string | null
          created_at: string
          id: string
          property_id: string | null
          question: string
          realtor_id: string | null
          renter_id: string
          source: string
          source_message_id: string | null
          status: Database["public"]["Enums"]["escalation_status"]
          updated_at: string
        }
        Insert: {
          answered_message_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          property_id?: string | null
          question: string
          realtor_id?: string | null
          renter_id: string
          source?: string
          source_message_id?: string | null
          status?: Database["public"]["Enums"]["escalation_status"]
          updated_at?: string
        }
        Update: {
          answered_message_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          property_id?: string | null
          question?: string
          realtor_id?: string | null
          renter_id?: string
          source?: string
          source_message_id?: string | null
          status?: Database["public"]["Enums"]["escalation_status"]
          updated_at?: string
        }
        Relationships: []
      }
      concierge_mail_threads: {
        Row: {
          contact_email: string
          contact_name: string | null
          created_at: string
          id: string
          last_message_at: string
          status: string
          subject: string | null
          subject_key: string
        }
        Insert: {
          contact_email: string
          contact_name?: string | null
          created_at?: string
          id?: string
          last_message_at?: string
          status?: string
          subject?: string | null
          subject_key: string
        }
        Update: {
          contact_email?: string
          contact_name?: string | null
          created_at?: string
          id?: string
          last_message_at?: string
          status?: string
          subject?: string | null
          subject_key?: string
        }
        Relationships: []
      }
      contact_checks: {
        Row: {
          checked_at: string
          checked_by: string
          evidence_url: string | null
          found_via: string | null
          id: string
          listing_id: string
          note: string | null
          phone_e164: string | null
          result: string
        }
        Insert: {
          checked_at?: string
          checked_by: string
          evidence_url?: string | null
          found_via?: string | null
          id?: string
          listing_id: string
          note?: string | null
          phone_e164?: string | null
          result: string
        }
        Update: {
          checked_at?: string
          checked_by?: string
          evidence_url?: string | null
          found_via?: string | null
          id?: string
          listing_id?: string
          note?: string | null
          phone_e164?: string | null
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_checks_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "external_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_reveals: {
        Row: {
          listing_id: string
          revealed_at: string
          user_id: string
        }
        Insert: {
          listing_id: string
          revealed_at?: string
          user_id: string
        }
        Update: {
          listing_id?: string
          revealed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_reveals_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "external_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      crawl_runs: {
        Row: {
          attempted: number
          created_at: string
          duplicates: number
          error: string | null
          finished_at: string | null
          healthy: boolean
          id: string
          location: string | null
          reasons: Json
          rejected: number
          source: string
          started_at: string
          updated: number
          verdict: string | null
          written: number
        }
        Insert: {
          attempted?: number
          created_at?: string
          duplicates?: number
          error?: string | null
          finished_at?: string | null
          healthy?: boolean
          id?: string
          location?: string | null
          reasons?: Json
          rejected?: number
          source: string
          started_at?: string
          updated?: number
          verdict?: string | null
          written?: number
        }
        Update: {
          attempted?: number
          created_at?: string
          duplicates?: number
          error?: string | null
          finished_at?: string | null
          healthy?: boolean
          id?: string
          location?: string | null
          reasons?: Json
          rejected?: number
          source?: string
          started_at?: string
          updated?: number
          verdict?: string | null
          written?: number
        }
        Relationships: []
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
      events: {
        Row: {
          actor: string
          id: number
          item_id: string | null
          occurred_at: string
          payload: Json
          request_id: string
          type: string
        }
        Insert: {
          actor: string
          id?: number
          item_id?: string | null
          occurred_at?: string
          payload?: Json
          request_id: string
          type: string
        }
        Update: {
          actor?: string
          id?: number
          item_id?: string | null
          occurred_at?: string
          payload?: Json
          request_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "ops_request_items_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "request_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "ops_request_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "viewing_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      external_properties: {
        Row: {
          amenities: string[] | null
          area_sqm: number | null
          bedrooms: number | null
          bedrooms_is_min: boolean | null
          canonical_group_id: string | null
          city: string | null
          contact_name: string | null
          contact_phone: string | null
          contact_phone_e164: string | null
          crawled_at: string | null
          created_at: string | null
          deactivated_at: string | null
          delisted_at: string | null
          described_price_max_vnd: number | null
          described_price_min_vnd: number | null
          description: string | null
          district_code: string | null
          expires_at: string | null
          external_id: string
          highlights: string[] | null
          id: string
          image_conflict_dismissed_at: string | null
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
          price_confidence: string | null
          price_confirmed_at: string | null
          price_display: string | null
          price_vnd: number | null
          raw_data: Json | null
          raw_only: boolean
          realtor_id: string | null
          rooms: string | null
          size: string | null
          source: string
          source_agent_id: string | null
          source_url: string
          title: string
          updated_at: string | null
          verification_failures: number
          vibe: string | null
          vibe_analysis: Json | null
          vibe_status: string
          videos: Json
        }
        Insert: {
          amenities?: string[] | null
          area_sqm?: number | null
          bedrooms?: number | null
          bedrooms_is_min?: boolean | null
          canonical_group_id?: string | null
          city?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_phone_e164?: string | null
          crawled_at?: string | null
          created_at?: string | null
          deactivated_at?: string | null
          delisted_at?: string | null
          described_price_max_vnd?: number | null
          described_price_min_vnd?: number | null
          description?: string | null
          district_code?: string | null
          expires_at?: string | null
          external_id: string
          highlights?: string[] | null
          id?: string
          image_conflict_dismissed_at?: string | null
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
          price_confidence?: string | null
          price_confirmed_at?: string | null
          price_display?: string | null
          price_vnd?: number | null
          raw_data?: Json | null
          raw_only?: boolean
          realtor_id?: string | null
          rooms?: string | null
          size?: string | null
          source: string
          source_agent_id?: string | null
          source_url: string
          title: string
          updated_at?: string | null
          verification_failures?: number
          vibe?: string | null
          vibe_analysis?: Json | null
          vibe_status?: string
          videos?: Json
        }
        Update: {
          amenities?: string[] | null
          area_sqm?: number | null
          bedrooms?: number | null
          bedrooms_is_min?: boolean | null
          canonical_group_id?: string | null
          city?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_phone_e164?: string | null
          crawled_at?: string | null
          created_at?: string | null
          deactivated_at?: string | null
          delisted_at?: string | null
          described_price_max_vnd?: number | null
          described_price_min_vnd?: number | null
          description?: string | null
          district_code?: string | null
          expires_at?: string | null
          external_id?: string
          highlights?: string[] | null
          id?: string
          image_conflict_dismissed_at?: string | null
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
          price_confidence?: string | null
          price_confirmed_at?: string | null
          price_display?: string | null
          price_vnd?: number | null
          raw_data?: Json | null
          raw_only?: boolean
          realtor_id?: string | null
          rooms?: string | null
          size?: string | null
          source?: string
          source_agent_id?: string | null
          source_url?: string
          title?: string
          updated_at?: string | null
          verification_failures?: number
          vibe?: string | null
          vibe_analysis?: Json | null
          vibe_status?: string
          videos?: Json
        }
        Relationships: [
          {
            foreignKeyName: "external_properties_realtor_id_fkey"
            columns: ["realtor_id"]
            isOneToOne: false
            referencedRelation: "realtors"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: []
      }
      free_viewings: {
        Row: {
          item_id: string | null
          phone_e164: string
          request_id: string | null
          used_at: string
          user_id: string | null
        }
        Insert: {
          item_id?: string | null
          phone_e164: string
          request_id?: string | null
          used_at?: string
          user_id?: string | null
        }
        Update: {
          item_id?: string | null
          phone_e164?: string
          request_id?: string | null
          used_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "free_viewings_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "ops_request_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "free_viewings_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "viewing_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      inquiry_events: {
        Row: {
          actor: string
          created_at: string
          id: number
          inquiry_id: string
          occurred_at: string
          payload: Json
          type: string
        }
        Insert: {
          actor: string
          created_at?: string
          id?: never
          inquiry_id: string
          occurred_at?: string
          payload?: Json
          type: string
        }
        Update: {
          actor?: string
          created_at?: string
          id?: never
          inquiry_id?: string
          occurred_at?: string
          payload?: Json
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "inquiry_events_inquiry_id_fkey"
            columns: ["inquiry_id"]
            isOneToOne: false
            referencedRelation: "complex_inquiries"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          payload: Json
          run_after: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          kind: string
          last_error?: string | null
          locked_at?: string | null
          payload?: Json
          run_after: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          locked_at?: string | null
          payload?: Json
          run_after?: string
        }
        Relationships: []
      }
      listing_deep_analyses: {
        Row: {
          analysis: Json
          created_at: string
          id: string
          preference_fingerprint: string
          property_id: string
          property_type: string
          renter_id: string
        }
        Insert: {
          analysis: Json
          created_at?: string
          id?: string
          preference_fingerprint: string
          property_id: string
          property_type?: string
          renter_id: string
        }
        Update: {
          analysis?: Json
          created_at?: string
          id?: string
          preference_fingerprint?: string
          property_id?: string
          property_type?: string
          renter_id?: string
        }
        Relationships: []
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
      messages: {
        Row: {
          body: string | null
          channel: string
          created_at: string
          direction: string
          error: string | null
          id: string
          idempotency_key: string
          provider_id: string | null
          request_id: string | null
          sent_at: string | null
          status: string
          template_name: string | null
          to_phone: string
        }
        Insert: {
          body?: string | null
          channel?: string
          created_at?: string
          direction: string
          error?: string | null
          id?: string
          idempotency_key: string
          provider_id?: string | null
          request_id?: string | null
          sent_at?: string | null
          status: string
          template_name?: string | null
          to_phone: string
        }
        Update: {
          body?: string | null
          channel?: string
          created_at?: string
          direction?: string
          error?: string | null
          id?: string
          idempotency_key?: string
          provider_id?: string | null
          request_id?: string | null
          sent_at?: string | null
          status?: string
          template_name?: string | null
          to_phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "ops_request_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "viewing_requests"
            referencedColumns: ["id"]
          },
        ]
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
      operator_proposals: {
        Row: {
          action: string
          agent_version: string
          confidence: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          dedupe_key: string
          edited: boolean
          execute_after: string | null
          executed_action: string | null
          executed_at: string | null
          executed_input: Json | null
          id: string
          input: Json
          item_id: string | null
          rationale: string
          request_id: string
          status: string
        }
        Insert: {
          action: string
          agent_version: string
          confidence?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          dedupe_key: string
          edited?: boolean
          execute_after?: string | null
          executed_action?: string | null
          executed_at?: string | null
          executed_input?: Json | null
          id?: string
          input?: Json
          item_id?: string | null
          rationale: string
          request_id: string
          status?: string
        }
        Update: {
          action?: string
          agent_version?: string
          confidence?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          dedupe_key?: string
          edited?: boolean
          execute_after?: string | null
          executed_action?: string | null
          executed_at?: string | null
          executed_input?: Json | null
          id?: string
          input?: Json
          item_id?: string | null
          rationale?: string
          request_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_proposals_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "ops_request_items_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_proposals_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "request_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_proposals_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "ops_request_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_proposals_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "viewing_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      passes: {
        Row: {
          amount_usd: number
          expires_at: string
          id: string
          kind: string
          provider: string
          provider_order_id: string
          purchased_at: string
          refunded_at: string | null
          renter_id: string
          viewings_included: number
          viewings_used: number
        }
        Insert: {
          amount_usd: number
          expires_at: string
          id?: string
          kind: string
          provider?: string
          provider_order_id: string
          purchased_at?: string
          refunded_at?: string | null
          renter_id: string
          viewings_included: number
          viewings_used?: number
        }
        Update: {
          amount_usd?: number
          expires_at?: string
          id?: string
          kind?: string
          provider?: string
          provider_order_id?: string
          purchased_at?: string
          refunded_at?: string | null
          renter_id?: string
          viewings_included?: number
          viewings_used?: number
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
      realtor_contact_imports: {
        Row: {
          display_name: string | null
          imported_at: string
          masked_prefix: string
          phone_e164: string
          sheet_row: string | null
        }
        Insert: {
          display_name?: string | null
          imported_at?: string
          masked_prefix: string
          phone_e164: string
          sheet_row?: string | null
        }
        Update: {
          display_name?: string | null
          imported_at?: string
          masked_prefix?: string
          phone_e164?: string
          sheet_row?: string | null
        }
        Relationships: []
      }
      realtor_identities: {
        Row: {
          created_at: string
          display_name: string | null
          realtor_id: string
          source: string
          source_agent_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          realtor_id: string
          source: string
          source_agent_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          realtor_id?: string
          source?: string
          source_agent_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "realtor_identities_realtor_id_fkey"
            columns: ["realtor_id"]
            isOneToOne: false
            referencedRelation: "realtors"
            referencedColumns: ["id"]
          },
        ]
      }
      realtor_messages: {
        Row: {
          actor: string
          attachments: Json | null
          body: string
          claimed_at: string | null
          created_at: string
          direction: string
          error: string | null
          id: string
          idempotency_key: string
          inquiry_id: string | null
          item_id: string | null
          medium: string
          on_sent_event: Json | null
          provider_id: string | null
          purpose: string
          realtor_id: string | null
          request_id: string | null
          sent_at: string | null
          status: string
        }
        Insert: {
          actor: string
          attachments?: Json | null
          body: string
          claimed_at?: string | null
          created_at?: string
          direction: string
          error?: string | null
          id?: string
          idempotency_key: string
          inquiry_id?: string | null
          item_id?: string | null
          medium: string
          on_sent_event?: Json | null
          provider_id?: string | null
          purpose: string
          realtor_id?: string | null
          request_id?: string | null
          sent_at?: string | null
          status: string
        }
        Update: {
          actor?: string
          attachments?: Json | null
          body?: string
          claimed_at?: string | null
          created_at?: string
          direction?: string
          error?: string | null
          id?: string
          idempotency_key?: string
          inquiry_id?: string | null
          item_id?: string | null
          medium?: string
          on_sent_event?: Json | null
          provider_id?: string | null
          purpose?: string
          realtor_id?: string | null
          request_id?: string | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "realtor_messages_inquiry_id_fkey"
            columns: ["inquiry_id"]
            isOneToOne: false
            referencedRelation: "complex_inquiries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "realtor_messages_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "ops_request_items_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "realtor_messages_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "request_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "realtor_messages_realtor_id_fkey"
            columns: ["realtor_id"]
            isOneToOne: false
            referencedRelation: "realtors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "realtor_messages_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "ops_request_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "realtor_messages_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "viewing_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      realtors: {
        Row: {
          agency: string | null
          created_at: string
          display_name: string | null
          id: string
          language: string
          notes: string | null
          phone_e164: string
          updated_at: string
        }
        Insert: {
          agency?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          language?: string
          notes?: string | null
          phone_e164: string
          updated_at?: string
        }
        Update: {
          agency?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          language?: string
          notes?: string | null
          phone_e164?: string
          updated_at?: string
        }
        Relationships: []
      }
      renter_searches: {
        Row: {
          answers_message_id: string
          counted: boolean
          created_at: string
          filters: Json | null
          id: string
          listing_ids: string[]
          message_id: string | null
          query: string
          refused: string | null
          renter_id: string
        }
        Insert: {
          answers_message_id: string
          counted?: boolean
          created_at?: string
          filters?: Json | null
          id?: string
          listing_ids?: string[]
          message_id?: string | null
          query: string
          refused?: string | null
          renter_id: string
        }
        Update: {
          answers_message_id?: string
          counted?: boolean
          created_at?: string
          filters?: Json | null
          id?: string
          listing_ids?: string[]
          message_id?: string | null
          query?: string
          refused?: string | null
          renter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "renter_searches_answers_message_id_fkey"
            columns: ["answers_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renter_searches_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renter_searches_renter_id_fkey"
            columns: ["renter_id"]
            isOneToOne: false
            referencedRelation: "renters"
            referencedColumns: ["id"]
          },
        ]
      }
      renters: {
        Row: {
          created_at: string
          digest_opt_in_at: string | null
          display_name: string | null
          id: string
          opted_out_at: string | null
          phone_e164: string
          service_window_expires_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          digest_opt_in_at?: string | null
          display_name?: string | null
          id?: string
          opted_out_at?: string | null
          phone_e164: string
          service_window_expires_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          digest_opt_in_at?: string | null
          display_name?: string | null
          id?: string
          opted_out_at?: string | null
          phone_e164?: string
          service_window_expires_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      request_items: {
        Row: {
          created_at: string
          id: string
          listing_id: string
          price_vnd_at_request: number
          realtor_id: string | null
          request_id: string
          sort_order: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          listing_id: string
          price_vnd_at_request: number
          realtor_id?: string | null
          request_id: string
          sort_order?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          listing_id?: string
          price_vnd_at_request?: number
          realtor_id?: string | null
          request_id?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "request_items_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "external_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_items_realtor_id_fkey"
            columns: ["realtor_id"]
            isOneToOne: false
            referencedRelation: "realtors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "ops_request_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "viewing_requests"
            referencedColumns: ["id"]
          },
        ]
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
      viewing_requests: {
        Row: {
          availability: Json
          created_at: string
          id: string
          inquiry_id: string | null
          move_in_date: string | null
          ref: string
          renter_id: string
        }
        Insert: {
          availability?: Json
          created_at?: string
          id?: string
          inquiry_id?: string | null
          move_in_date?: string | null
          ref: string
          renter_id: string
        }
        Update: {
          availability?: Json
          created_at?: string
          id?: string
          inquiry_id?: string | null
          move_in_date?: string | null
          ref?: string
          renter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "viewing_requests_inquiry_id_fkey"
            columns: ["inquiry_id"]
            isOneToOne: false
            referencedRelation: "complex_inquiries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "viewing_requests_renter_id_fkey"
            columns: ["renter_id"]
            isOneToOne: false
            referencedRelation: "renters"
            referencedColumns: ["id"]
          },
        ]
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
      whatsapp_number_status: {
        Row: {
          checked_at: string | null
          id: string
          last_error: string | null
          previous_rating: string | null
          quality_rating: string | null
          rating_changed_at: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          checked_at?: string | null
          id?: string
          last_error?: string | null
          previous_rating?: string | null
          quality_rating?: string | null
          rating_changed_at?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          checked_at?: string | null
          id?: string
          last_error?: string | null
          previous_rating?: string | null
          quality_rating?: string | null
          rating_changed_at?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_template_status: {
        Row: {
          category: string | null
          created_at: string
          language: string | null
          last_synced_at: string
          meta_id: string | null
          name: string
          quality: string | null
          status: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          language?: string | null
          last_synced_at?: string
          meta_id?: string | null
          name: string
          quality?: string | null
          status: string
        }
        Update: {
          category?: string | null
          created_at?: string
          language?: string | null
          last_synced_at?: string
          meta_id?: string | null
          name?: string
          quality?: string | null
          status?: string
        }
        Relationships: []
      }
      zalo_bridge_status: {
        Row: {
          device: string | null
          id: string
          last_error: string | null
          last_seen_at: string | null
          paused: boolean
          sent_today: number
          updated_at: string
          version: string | null
        }
        Insert: {
          device?: string | null
          id?: string
          last_error?: string | null
          last_seen_at?: string | null
          paused?: boolean
          sent_today?: number
          updated_at?: string
          version?: string | null
        }
        Update: {
          device?: string | null
          id?: string
          last_error?: string | null
          last_seen_at?: string | null
          paused?: boolean
          sent_today?: number
          updated_at?: string
          version?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      crawl_health: {
        Row: {
          attempted: number | null
          day: string | null
          rejected: number | null
          rejection_rate: number | null
          runs: number | null
          source: string | null
          unhealthy_runs: number | null
          written: number | null
        }
        Relationships: []
      }
      ops_request_items_view: {
        Row: {
          area_sqm: number | null
          bedrooms: number | null
          created_at: string | null
          district_code: string | null
          id: string | null
          listing_id: string | null
          listing_location: string | null
          listing_title: string | null
          listing_url: string | null
          price_vnd_at_request: number | null
          realtor_id: string | null
          realtor_name: string | null
          realtor_phone: string | null
          request_id: string | null
          request_ref: string | null
          sort_order: number | null
        }
        Relationships: [
          {
            foreignKeyName: "request_items_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "external_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_items_realtor_id_fkey"
            columns: ["realtor_id"]
            isOneToOne: false
            referencedRelation: "realtors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "ops_request_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "viewing_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_request_queue: {
        Row: {
          age_seconds: number | null
          availability: Json | null
          created_at: string | null
          id: string | null
          item_count: number | null
          move_in_date: string | null
          ref: string | null
          unresolved_realtor_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      active_pass_expires_at: { Args: { _user_id: string }; Returns: string }
      admin_external_listing_sources: {
        Args: { _ids: string[] }
        Returns: {
          id: string
          raw_data: Json
          source_url: string
        }[]
      }
      apply_realtor_contacts: {
        Args: never
        Returns: {
          listings_linked: number
          realtors_upserted: number
        }[]
      }
      base_viewing_allowance_remaining: {
        Args: { _user_id: string }
        Returns: number
      }
      can_create_fast_track_request:
        | { Args: { _user_id: string }; Returns: boolean }
        | { Args: { _needed: number; _user_id: string }; Returns: boolean }
      canonical_price_vnd: {
        Args: { _price: number; _price_display: string; _source: string }
        Returns: number
      }
      claim_jobs: {
        Args: { _kinds: string[]; _limit?: number }
        Returns: {
          attempts: number
          completed_at: string | null
          created_at: string
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          payload: Json
          run_after: string
        }[]
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cleanup_expired_external_properties: { Args: never; Returns: undefined }
      complex_listing_ids: {
        Args: { _complex_id: string; _since: string }
        Returns: string[]
      }
      consume_viewing_credits: {
        Args: { _needed: number; _request_id?: string; _user_id: string }
        Returns: number
      }
      deactivate_expired_properties: { Args: never; Returns: undefined }
      detect_city: { Args: { location_text: string }; Returns: string }
      expire_stale_escalations: { Args: never; Returns: number }
      free_viewing_trial_unlocked: {
        Args: { _user_id: string }
        Returns: boolean
      }
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
      has_active_pass: { Args: { _user_id: string }; Returns: boolean }
      has_complimentary_pass: { Args: { _user_id: string }; Returns: boolean }
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
      listings_missing_contact: {
        Args: { _limit?: number }
        Returns: {
          listing_id: string
          requested: boolean
          shows: string
          signed_as: string
          source: string
          source_url: string
          title: string
          visible_digits: string
        }[]
      }
      mask_phone_numbers: {
        Args: { _body: string; _renter_phone: string }
        Returns: string
      }
      normalize_location: { Args: { location_text: string }; Returns: string }
      normalize_vn_phone: { Args: { raw: string }; Returns: string }
      openai_spend_today: { Args: never; Returns: number }
      ops_area_roster: { Args: { _district_codes: string[] }; Returns: Json }
      ops_building_roster: { Args: never; Returns: Json }
      ops_inquiries: { Args: never; Returns: Json }
      ops_inquiry_detail: { Args: { _inquiry_id: string }; Returns: Json }
      ops_listing_url: { Args: { _listing_id: string }; Returns: string }
      ops_request_thread: { Args: { _request_id: string }; Returns: Json }
      parse_area_sqm: { Args: { _size: string }; Returns: number }
      parse_bedrooms: { Args: { _rooms: string }; Returns: number }
      parse_bedrooms_is_min: { Args: { _rooms: string }; Returns: boolean }
      pass_viewing_credits_remaining: {
        Args: { _user_id: string }
        Returns: number
      }
      phone_mask_prefix: { Args: { raw: string }; Returns: string }
      price_confidence_for: {
        Args: {
          _described_max: number
          _described_min: number
          _price_vnd: number
        }
        Returns: string
      }
      prune_orphan_listing_group_refs: { Args: never; Returns: number }
      record_contact_check: {
        Args: {
          _checked_by?: string
          _evidence_url?: string
          _found_via?: string
          _listing_id: string
          _name?: string
          _note?: string
          _phone?: string
          _result: string
        }
        Returns: Json
      }
      record_pass_refund: {
        Args: {
          _pass_days: number
          _provider_order_id: string
          _refunded_at: string
        }
        Returns: Json
      }
      release_job: { Args: { _error: string; _id: string }; Returns: undefined }
      renter_national_number: { Args: { _e164: string }; Returns: string }
      reveal_listing_contact: { Args: { _listing_id: string }; Returns: Json }
      set_fast_track_archived: {
        Args: { _archived: boolean; _request_id: string }
        Returns: {
          archived_at: string
          id: string
        }[]
      }
      trim_old_logs: {
        Args: { _older_than?: string }
        Returns: {
          rows_deleted: number
          source: string
        }[]
      }
      unstick_jobs: { Args: { _older_than?: string }; Returns: number }
      validate_email: { Args: { email_input: string }; Returns: boolean }
      validate_phone: { Args: { phone_input: string }; Returns: boolean }
      verify_cron_secret: { Args: { _token: string }; Returns: boolean }
      viewing_listings_booked_since: {
        Args: { _since: string; _user_id: string }
        Returns: number
      }
      vn_district_code: {
        Args: { _city: string; _location: string }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user" | "realtor" | "ops"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user", "realtor", "ops"],
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
