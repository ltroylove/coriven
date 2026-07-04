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
    PostgrestVersion: "14.5"
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
      daily_briefings: {
        Row: {
          briefing_date: string
          content: Json
          created_at: string
          delivered_at: string | null
          id: string
          user_id: string
          was_delivered: boolean
        }
        Insert: {
          briefing_date: string
          content: Json
          created_at?: string
          delivered_at?: string | null
          id?: string
          user_id: string
          was_delivered?: boolean
        }
        Update: {
          briefing_date?: string
          content?: Json
          created_at?: string
          delivered_at?: string | null
          id?: string
          user_id?: string
          was_delivered?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "daily_briefings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      goals: {
        Row: {
          confidence: Database["public"]["Enums"]["goal_confidence"]
          created_at: string
          id: string
          last_activity_at: string | null
          last_nudge_at: string | null
          life_area_id: string | null
          momentum: Database["public"]["Enums"]["goal_momentum"]
          status: Database["public"]["Enums"]["goal_status"]
          success_metrics: string | null
          title: string
          updated_at: string
          user_id: string
          why_it_matters: string | null
        }
        Insert: {
          confidence?: Database["public"]["Enums"]["goal_confidence"]
          created_at?: string
          id?: string
          last_activity_at?: string | null
          last_nudge_at?: string | null
          life_area_id?: string | null
          momentum?: Database["public"]["Enums"]["goal_momentum"]
          status?: Database["public"]["Enums"]["goal_status"]
          success_metrics?: string | null
          title: string
          updated_at?: string
          user_id: string
          why_it_matters?: string | null
        }
        Update: {
          confidence?: Database["public"]["Enums"]["goal_confidence"]
          created_at?: string
          id?: string
          last_activity_at?: string | null
          last_nudge_at?: string | null
          life_area_id?: string | null
          momentum?: Database["public"]["Enums"]["goal_momentum"]
          status?: Database["public"]["Enums"]["goal_status"]
          success_metrics?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          why_it_matters?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goals_life_area_id_fkey"
            columns: ["life_area_id"]
            isOneToOne: false
            referencedRelation: "life_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      life_areas: {
        Row: {
          color: string | null
          created_at: string
          icon: string | null
          id: string
          name: string
          sort_order: number
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          sort_order?: number
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          sort_order?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "life_areas_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      projects: {
        Row: {
          created_at: string
          description: string | null
          goal_id: string | null
          id: string
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          goal_id?: string | null
          id?: string
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          goal_id?: string | null
          id?: string
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      integrations: {
        Row: {
          id: string
          user_id: string
          provider: Database["public"]["Enums"]["integration_provider"]
          nango_connection_id: string
          scopes: string[]
          connected_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          provider: Database["public"]["Enums"]["integration_provider"]
          nango_connection_id: string
          scopes?: string[]
          connected_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          provider?: Database["public"]["Enums"]["integration_provider"]
          nango_connection_id?: string
          scopes?: string[]
          connected_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      behavioral_constraints: {
        Row: {
          id: string
          user_id: string
          rule: string
          rationale: string
          scope: string
          is_locked: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          rule: string
          rationale: string
          scope?: string
          is_locked?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          rule?: string
          rationale?: string
          scope?: string
          is_locked?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "behavioral_constraints_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      conversation_messages: {
        Row: {
          content: string
          conversation_id: string | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["message_role"]
          tool_calls: Json | null
          user_id: string
        }
        Insert: {
          content: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["message_role"]
          tool_calls?: Json | null
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["message_role"]
          tool_calls?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      conversation_summaries: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          message_range: unknown
          summary: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          message_range?: unknown
          summary: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          message_range?: unknown
          summary?: string
          user_id?: string
        }
        Relationships: []
      }
      entity_profiles: {
        Row: {
          aliases: string[]
          created_at: string
          description: string | null
          id: string
          last_mentioned: string | null
          mention_count: number
          name: string
          recency_weight: number
          type: Database["public"]["Enums"]["entity_profile_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          aliases?: string[]
          created_at?: string
          description?: string | null
          id?: string
          last_mentioned?: string | null
          mention_count?: number
          name: string
          recency_weight?: number
          type?: Database["public"]["Enums"]["entity_profile_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          aliases?: string[]
          created_at?: string
          description?: string | null
          id?: string
          last_mentioned?: string | null
          mention_count?: number
          name?: string
          recency_weight?: number
          type?: Database["public"]["Enums"]["entity_profile_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      memories: {
        Row: {
          content: string
          created_at: string
          embedding: string | null
          id: string
          source: string | null
          superseded_by: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          source?: string | null
          superseded_by?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          source?: string | null
          superseded_by?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memories_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "memories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          briefing_time: string
          created_at: string
          email: string
          id: string
          name: string | null
          timezone: string
        }
        Insert: {
          briefing_time?: string
          created_at?: string
          email: string
          id: string
          name?: string | null
          timezone?: string
        }
        Update: {
          briefing_time?: string
          created_at?: string
          email?: string
          id?: string
          name?: string | null
          timezone?: string
        }
        Relationships: []
      }
      sentinel_context: {
        Row: {
          built_at: string | null
          id: string
          package: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          built_at?: string | null
          id?: string
          package?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          built_at?: string | null
          id?: string
          package?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      task_reminders: {
        Row: {
          created_at: string
          id: string
          last_fired_at: string | null
          recurrence_end_at: string | null
          recurrence_type: Database["public"]["Enums"]["recurrence_type"]
          remind_at: string
          snoozed_until: string | null
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_fired_at?: string | null
          recurrence_end_at?: string | null
          recurrence_type?: Database["public"]["Enums"]["recurrence_type"]
          remind_at: string
          snoozed_until?: string | null
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_fired_at?: string | null
          recurrence_end_at?: string | null
          recurrence_type?: Database["public"]["Enums"]["recurrence_type"]
          remind_at?: string
          snoozed_until?: string | null
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_reminders_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string | null
          due_at: string | null
          goal_id: string | null
          id: string
          priority: Database["public"]["Enums"]["task_priority"]
          project_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          goal_id?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          goal_id?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          }
        ]
      }
      approval_queue: {
        Row: {
          id: string
          user_id: string
          action_type: string
          provider: string
          payload: Json
          ai_summary: string | null
          status: string
          created_at: string
          reviewed_at: string | null
          executed_at: string | null
          error_code: string | null
        }
        Insert: {
          id?: string
          user_id: string
          action_type: string
          provider: string
          payload: Json
          ai_summary?: string | null
          status?: string
          created_at?: string
          reviewed_at?: string | null
          executed_at?: string | null
          error_code?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          action_type?: string
          provider?: string
          payload?: Json
          ai_summary?: string | null
          status?: string
          created_at?: string
          reviewed_at?: string | null
          executed_at?: string | null
          error_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      audit_log: {
        Row: {
          id: string
          user_id: string
          approval_id: string | null
          action_type: string
          provider: string
          status: string
          error_code: string | null
          delegation: Json
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          approval_id?: string | null
          action_type: string
          provider: string
          status: string
          error_code?: string | null
          delegation: Json
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          approval_id?: string | null
          action_type?: string
          provider?: string
          status?: string
          error_code?: string | null
          delegation?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "approval_queue"
            referencedColumns: ["id"]
          }
        ]
      }
      tool_permissions: {
        Row: {
          enabled: boolean
          granted_at: string
          id: string
          tool_name: string
          user_id: string
        }
        Insert: {
          enabled?: boolean
          granted_at?: string
          id?: string
          tool_name: string
          user_id: string
        }
        Update: {
          enabled?: boolean
          granted_at?: string
          id?: string
          tool_name?: string
          user_id?: string
        }
        Relationships: []
      }
      user_context: {
        Row: {
          facts: Json
          id: string
          preferences: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          facts?: Json
          id?: string
          preferences?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          facts?: Json
          id?: string
          preferences?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      match_memories: {
        Args: {
          match_count: number
          match_threshold: number
          match_user_id: string
          query_embedding: string
        }
        Returns: {
          content: string
          id: string
          similarity: number
        }[]
      }
    }
    Enums: {
      integration_provider: "gmail" | "outlook" | "google_calendar" | "outlook_calendar"
      entity_profile_type: "person" | "place" | "project" | "thing" | "resource"
      goal_confidence: "high" | "medium" | "low"
      goal_momentum: "improving" | "stable" | "declining"
      goal_status: "active" | "achieved" | "paused" | "abandoned"
      message_role: "user" | "assistant"
      recurrence_type:
        | "none"
        | "daily"
        | "weekdays"
        | "weekly"
        | "monthly"
        | "yearly"
      task_priority: "low" | "medium" | "high" | "urgent"
      task_status: "pending" | "in_progress" | "done" | "cancelled"
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
      entity_profile_type: ["person", "place", "project", "thing", "resource"],
      goal_confidence: ["high", "medium", "low"],
      goal_momentum: ["improving", "stable", "declining"],
      goal_status: ["active", "achieved", "paused", "abandoned"],
      message_role: ["user", "assistant"],
      recurrence_type: [
        "none",
        "daily",
        "weekdays",
        "weekly",
        "monthly",
        "yearly",
      ],
      task_priority: ["low", "medium", "high", "urgent"],
      task_status: ["pending", "in_progress", "done", "cancelled"],
    },
  },
} as const
