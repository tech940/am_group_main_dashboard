-- 0077: Add 'h_promise_head' role to the role enum
ALTER TYPE role ADD VALUE IF NOT EXISTS 'h_promise_head';
