const mongoose = require("mongoose");
const { Product, Group_session } = require("../models/models");

// Generate random join code
function generateJoinCode() {
    // Alphanumeric only — the join code sits directly in the URL path
    // (/group-sessions/:joinCode/...), so it must stay URL-safe.
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";

    for (let i = 0; i < 8; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }

    return code;
}

const isValidObjectId = (id) => mongoose.isValidObjectId(id);

// --- Media storage (Cloudinary) ---------------------------------------------
// The backend never uploads anything; it only stores and hands out URLs. All of
// the storage config lives in .env so the same code points at a different
// Cloudinary account (or a local stub) without a code change.
const CLOUDINARY_BASE_URL = process.env.CLOUDINARY_BASE_URL || "https://res.cloudinary.com";
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "";
// Empty by default: most Cloudinary accounts now use Dynamic Folders, where the
// folder shown in the console is display metadata only and is NOT part of the
// public_id used in delivery URLs — so the default delivery path is just
// <public_id>.<format>, no folder prefix. Only set this if your account uses
// the older Fixed/Rigid folder mode, where the folder really is baked into the
// public_id and delivery 404s without it.
const CLOUDINARY_FOLDER = process.env.CLOUDINARY_FOLDER || "";
const CLOUDINARY_FORMAT = process.env.CLOUDINARY_IMAGE_FORMAT || "jpg";
// Named Cloudinary transformations, applied as a URL path segment.
const CLOUDINARY_THUMB = process.env.CLOUDINARY_THUMB_TRANSFORM || "c_fill,w_400,h_400,q_auto,f_auto";
const CLOUDINARY_FULL = process.env.CLOUDINARY_FULL_TRANSFORM || "c_fill,w_1200,h_800,q_auto,f_auto";

// Turns a product name into a Cloudinary public id: "Gulab Jamun (2 pc)" -> "gulab-jamun-2-pc".
const toPublicId = (name) =>
    name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

// Builds one delivery URL. Returns null when no cloud name is configured, so a
// deployment without media storage simply ends up with an empty image_urls array
// instead of URLs that would 404.
const buildMediaUrl = (publicId, transform = CLOUDINARY_THUMB) => {
    if (!CLOUDINARY_CLOUD_NAME) {
        return null;
    }

    const base = CLOUDINARY_BASE_URL.replace(/\/+$/, "");
    const path = [CLOUDINARY_FOLDER, publicId].filter(Boolean).join("/");

    return `${base}/${CLOUDINARY_CLOUD_NAME}/image/upload/${transform}/${path}.${CLOUDINARY_FORMAT}`;
};

// The image set stored on a product: [thumbnail, full size].
const buildProductImageUrls = (name) => {
    const publicId = toPublicId(name);

    return [
        buildMediaUrl(publicId, CLOUDINARY_THUMB),
        buildMediaUrl(publicId, CLOUDINARY_FULL)
    ].filter(Boolean);
};

// Atomically reserves stock: only succeeds if qty currently available is >= qty requested.
// This single findOneAndUpdate is what stops two concurrent requests from both.
const reserveStock = async (productId, qty) => {
    return Product.findOneAndUpdate(
        { _id: productId, qty: { $gte: qty } },
        [
            { $set: { qty: { $subtract: ["$qty", qty] } } },
            { $set: { instock: { $gt: ["$qty", 0] } } }
        ],
        { new: true, updatePipeline: true }
    );
};

// Atomically releases previously reserved stock back to the product.
const releaseStock = async (productId, qty) => {
    return Product.findOneAndUpdate(
        { _id: productId },
        [
            { $set: { qty: { $add: ["$qty", qty] } } },
            { $set: { instock: { $gt: ["$qty", 0] } } }
        ],
        { new: true, updatePipeline: true }
    );
};

// Shapes the group session into the JSON sent to REST callers and WebSocket clients.
const getGroupState = async (joinCode) => {
    const session = await Group_session.findOne({ join_code: joinCode })
        .populate("host", "username")
        .populate("participants.user", "username")
        .populate("cart.product", "name price qty instock image_urls")
        .populate("cart.added_by", "username");

    if (!session) {
        return null;
    }

    return {
        join_code: session.join_code,
        active: session.active,
        host: {
            user: session.host,
            // Falls back for sessions created before hosts had display names.
            display_name: session.host_display_name || session.host?.username
        },
        participants: session.participants.map((p) => ({
            user: p.user,
            display_name: p.display_name,
            ready: p.ready
        })),
        cart: session.cart.map((c) => ({
            product: c.product,
            qty: c.qty,
            added_by: c.added_by
        }))
    };
};

// Pushes a one-off event to every socket in the join-code room.
const emitToGroup = (joinCode, event, payload) => {
    const { getIO } = require("../sockets/socket");
    const io = getIO();

    if (io) {
        io.to(joinCode).emit(event, payload);
    }
};

// Fetches the latest group state and pushes it to every socket in the join-code room.
const broadcastGroupState = async (joinCode) => {
    const state = await getGroupState(joinCode);

    if (state) {
        emitToGroup(joinCode, "group:state", state);
    }

    return state;
};

module.exports = {
    generateJoinCode,
    isValidObjectId,
    toPublicId,
    buildMediaUrl,
    buildProductImageUrls,
    reserveStock,
    releaseStock,
    getGroupState,
    emitToGroup,
    broadcastGroupState
};
