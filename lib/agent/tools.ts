import "server-only";
import { z } from "zod";
import { defineTool, type AgentTool } from "./defineTool";
import { getSupabase } from "../supabase";
import { CURRENT_STUDENT_ID, formatSlot } from "../campusbite";


const getMenu = defineTool({
  name: "getMenu",
  description:
    "Use this when the user asks what food is available, wants menu details, or gives dietary or price preferences.",
  schema: z.object({
    category: z.enum(["meal", "snack", "drink", "sweet"]).optional().describe("Menu category to filter by"),
    veg_only: z.boolean().optional().describe("Whether to return vegetarian items only"),
    max_price: z.number().int().optional().describe("Maximum item price in whole rupees"),
  }),
  run: async ({ category, veg_only, max_price }) => {
    let query = getSupabase()
      .from("menu_items")
      .select("id, name, category, price, is_veg, stock, description")
      .gt("stock", 0)
      .order("category", { ascending: true })
      .order("price", { ascending: true });
    if (category) query = query.eq("category", category);
    if (veg_only) query = query.eq("is_veg", true);
    if (max_price !== undefined) query = query.lte("price", max_price);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return { items: data };
  },
});

const getWalletBalance = defineTool({
  name: "getWalletBalance",
  description: "Use this when the user asks about their wallet balance or before deciding whether an order is affordable.",
  schema: z.object({}),
  run: async () => {
    const { data, error } = await getSupabase()
      .from("wallets")
      .select("name, balance")
      .eq("student_id", CURRENT_STUDENT_ID)
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
});

const getPickupSlots = defineTool({
  name: "getPickupSlots",
  description: "Use this when the user asks about pickup times or before choosing a pickup time for an order.",
  schema: z.object({}),
  run: async () => {
    const { data, error } = await getSupabase()
      .from("pickup_slots")
      .select("id, slot_time, capacity, booked")
      .order("slot_time", { ascending: true });
    if (error) throw new Error(error.message);
    return {
      slots: data
        .map((slot) => ({
          slot_id: slot.id,
          time: formatSlot(slot.slot_time),
          free: slot.capacity - slot.booked,
        }))
        .filter((slot) => slot.free > 0),
    };
  },
});

const getMyOrders = defineTool({
  name: "getMyOrders",
  description: "Use this when the user asks about their recent orders or wants to refer to an order they placed.",
  schema: z.object({}),
  run: async () => {
    const { data, error } = await getSupabase()
      .from("orders")
      .select("id, status, total, created_at, pickup:pickup_slots(slot_time), items:order_items(item:menu_items(name))")
      .eq("student_id", CURRENT_STUDENT_ID)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);
    return {
      orders: data.map((order) => {
        const pickup = Array.isArray(order.pickup) ? order.pickup[0] : order.pickup;
        const items = Array.isArray(order.items) ? order.items : [];
        return {
          id: order.id,
          status: order.status,
          total: order.total,
          pickup_time: pickup ? formatSlot(pickup.slot_time) : null,
          item_names: items.flatMap((line) => {
            const menuItem = Array.isArray(line.item) ? line.item[0] : line.item;
            return menuItem?.name ? [menuItem.name] : [];
          }),
        };
      }),
    };
  },
});

const placeOrder = defineTool({
  name: "placeOrder",
  description: "Use this when the user confirms they want to place an order for menu items and a pickup slot.",
  writes: true,
  schema: z.object({
    items: z
      .array(
        z.object({
          menu_item_id: z.number().int().positive().describe("The menu item id"),
          quantity: z.number().int().min(1).max(5).describe("Quantity to order, from 1 to 5"),
        })
      )
      .min(1)
      .describe("At least one menu item and quantity to order"),
    slot_id: z.number().int().positive().describe("The selected pickup slot id"),
  }),
  run: async ({ items, slot_id }) => {
    const { data, error } = await getSupabase().rpc("place_order", {
      p_student_id: CURRENT_STUDENT_ID,
      p_slot_id: slot_id,
      p_items: items,
    });
    if (error) throw new Error(error.message);
    return data;
  },
});

const cancelOrder = defineTool({
  name: "cancelOrder",
  description: "Use this when the user asks to cancel one of their orders; check their recent orders if the order id is unknown.",
  writes: true,
  schema: z.object({
    order_id: z.number().int().positive().describe("The id of the order to cancel"),
  }),
  run: async ({ order_id }) => {
    const { data, error } = await getSupabase().rpc("cancel_order", {
      p_student_id: CURRENT_STUDENT_ID,
      p_order_id: order_id,
    });
    if (error) throw new Error(error.message);
    return data;
  },
});

export const tools: AgentTool[] = [getMenu, getWalletBalance, getPickupSlots, getMyOrders, placeOrder, cancelOrder];
