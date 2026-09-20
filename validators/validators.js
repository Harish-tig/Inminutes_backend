const { z } = require("zod");

// Matches a Mongo ObjectId string (24 hex chars).
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const UserSchemaValidator = z.object({
    username: z.string().min(6)
});

// Display names are shown to the whole group, so they get the same rules
// whether they belong to the host or to a participant.
const displayName = z.string().trim().min(1).max(30);

const groupJoinvalidators = z.object({
    userId: objectId,
    display_name: displayName
});

// display_name is optional — a host that omits it falls back to their username.
const createGroupSessionValidator = z.object({
    userId: objectId,
    display_name: displayName.optional()
});

// The host id travels in the query string: the URL path already carries the id
// of the participant being removed.
const kickParticipantValidator = z.object({
    userId: objectId
});

const readyValidator = z.object({
    ready: z.boolean()
});

const placeGroupOrderValidator = z.object({
    userId: objectId
});

// Normal cart
const addCartItemValidator = z.object({
    productId: objectId,
    qty: z.number().int().min(1)
});

const updateCartItemValidator = z.object({
    qty: z.number().int().min(1)
});

// Group cart — userId travels in the body/query since it isn't part of the URL.
const addGroupCartItemValidator = z.object({
    userId: objectId,
    productId: objectId,
    qty: z.number().int().min(1)
});

const updateGroupCartItemValidator = z.object({
    userId: objectId,
    qty: z.number().int().min(1)
});

const removeGroupCartItemValidator = z.object({
    userId: objectId
});

module.exports = {
    objectId,
    displayName,
    UserSchemaValidator,
    groupJoinvalidators,
    createGroupSessionValidator,
    kickParticipantValidator,
    readyValidator,
    placeGroupOrderValidator,
    addCartItemValidator,
    updateCartItemValidator,
    addGroupCartItemValidator,
    updateGroupCartItemValidator,
    removeGroupCartItemValidator
};
