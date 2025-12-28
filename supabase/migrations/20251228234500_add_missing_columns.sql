-- Migration: Add Missing Columns to Empresas
-- Description: Adds columns required by the frontend that were missing in the base table.

ALTER TABLE empresas 
ADD COLUMN IF NOT EXISTS drive_link text,
ADD COLUMN IF NOT EXISTS cnpj text,
ADD COLUMN IF NOT EXISTS ativo boolean DEFAULT true;
