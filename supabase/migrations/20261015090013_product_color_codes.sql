-- ===========================================================================
-- Product colours: an optional stable `code` per colour
--
-- Colours are picked from a canonical, searchable library (name -> hex) in the app. The stored identity
-- of a library colour should be its stable code, not a translated label, so every reader can show it in
-- their own language. `code` is OPTIONAL and additive: historical rows (name + hex only, or name only)
-- stay valid, and the database never learns the library — it only keeps a well-formed code, or the
-- reserved `custom` for a value that matches no library name.
-- ===========================================================================
create or replace function app.normalize_product_color_items(p_items jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_out        jsonb := '[]'::jsonb;
  v_seen       text[] := '{}';
  v_seen_codes text[] := '{}';
  e      jsonb;
  v_name text;
  v_hex  text;
  v_code text;
  v_item jsonb;
begin
  if p_items is null or p_items = 'null'::jsonb then return '[]'::jsonb; end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'colors must be a list' using errcode = '22023';
  end if;
  for e in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(e) <> 'object' then
      raise exception 'each color must be an object with a name and a value' using errcode = '22023';
    end if;
    v_name := btrim(regexp_replace(coalesce(e ->> 'name', ''), '\s+', ' ', 'g'));
    if v_name = '' then continue; end if;
    if char_length(v_name) > 40 then
      raise exception 'a color name is limited to 40 characters' using errcode = '22023';
    end if;
    v_hex := nullif(btrim(coalesce(e ->> 'hex', '')), '');
    if v_hex is not null then
      v_hex := upper(v_hex);
      if v_hex !~ '^#[0-9A-F]{6}$' then
        raise exception 'a color value must be a hex code like #B96F52' using errcode = '22023';
      end if;
    end if;
    v_code := nullif(btrim(coalesce(e ->> 'code', '')), '');
    if v_code is not null and v_code !~ '^[a-z][a-z0-9_]{0,39}$' then
      raise exception 'a color code must be lower-case letters, digits and underscores' using errcode = '22023';
    end if;
    if lower(v_name) = any (v_seen) then continue; end if;
    -- one library colour once; `custom` is the shared code of every unnamed value, so it may repeat
    if v_code is not null and v_code <> 'custom' and v_code = any (v_seen_codes) then continue; end if;
    v_seen := v_seen || lower(v_name);
    if v_code is not null then v_seen_codes := v_seen_codes || v_code; end if;
    v_item := jsonb_build_object('name', v_name, 'hex', v_hex);
    if v_code is not null then v_item := v_item || jsonb_build_object('code', v_code); end if;
    v_out := v_out || jsonb_build_array(v_item);
  end loop;
  if jsonb_array_length(v_out) > 12 then
    raise exception 'a product can have at most 12 colors' using errcode = '22023';
  end if;
  return v_out;
end;
$$;
