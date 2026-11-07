import { getSupabaseClient } from "./supabase";
import {
  exchangeCatalogSchema,
  listingPageSchema,
  listingSchema,
  exchangeError,
  type ExchangeFilters,
  type ListingInput,
} from "./exchange";
export function exchangeClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error("Exchange setup is still in progress.");
  return client;
}
export async function loadExchangeCatalog(campusSlug = "wwu") {
  const { data, error } = await exchangeClient().rpc("exchange_catalog", {
    campus_slug: campusSlug,
  });
  if (error) throw new Error(exchangeError(error));
  return exchangeCatalogSchema.parse(data);
}
export async function loadExchangeListings(
  campus: string,
  filters: ExchangeFilters,
) {
  const { data, error } = await exchangeClient().rpc("exchange_listings", {
    campus_id: campus,
    search_text: filters.query,
    post_kind: filters.kind,
    category_id: filters.category,
    location_id: filters.location || null,
    available_only: filters.available,
    mine_only: filters.mine,
    sort_order: filters.sort,
    page_number: filters.page,
  });
  if (error) throw new Error(exchangeError(error));
  return listingPageSchema.parse(data);
}
export async function loadExchangeListing(id: string) {
  const { data, error } = await exchangeClient().rpc("exchange_listing", {
    listing_id: id,
  });
  if (error) throw new Error(exchangeError(error));
  return listingSchema.parse(data);
}
export async function saveExchangeListing(
  campus: string,
  id: string,
  payload: ListingInput,
  key: string,
  updatedAt: string | null,
) {
  const { data, error } = await exchangeClient().rpc("save_exchange_listing", {
    campus_id: campus,
    listing_id: id,
    payload,
    idempotency_key: key,
    expected_updated_at: updatedAt,
  });
  if (error) throw new Error(exchangeError(error));
  if (data?.error) throw new Error(exchangeError({ message: data.error.code }));
  return listingSchema.parse(data.data);
}
export async function uploadListingPhoto(file: File) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024 ||
    file.size === 0
  )
    throw new Error("Choose a JPG, PNG or WebP photo smaller than 5 MB.");
  const client = exchangeClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("Sign in before uploading a photo.");
  const ext =
    file.type === "image/jpeg"
      ? "jpg"
      : file.type === "image/png"
        ? "png"
        : "webp";
  const path = `${data.user.id}/${crypto.randomUUID()}.${ext}`;
  const uploaded = await client.storage
    .from("listing-photos")
    .upload(path, file, {
      upsert: false,
      contentType: file.type,
      cacheControl: "3600",
    });
  if (uploaded.error)
    throw new Error(
      "Your photo could not be uploaded. Check the file and try again.",
    );
  return path;
}
export async function signListingPhotos(paths: string[]) {
  if (!paths.length) return new Map<string, string>();
  const { data, error } = await exchangeClient()
    .storage.from("listing-photos")
    .createSignedUrls([...new Set(paths)], 600);
  if (error) throw new Error("Photos could not be loaded.");
  return new Map<string, string>(
    (data ?? []).flatMap((p) =>
      p.path && p.signedUrl ? [[p.path, p.signedUrl]] : [],
    ),
  );
}
