const { User, Order, Group_session } = require("../models/models");
const validator = require("../validators/validators");
const {
    isValidObjectId,
    generateJoinCode,
    reserveStock,
    releaseStock,
    getGroupState,
    emitToGroup,
    broadcastGroupState
} = require("../utils/utils");

// Generate unique join code
async function createUniqueJoinCode() {
    let code;

    do {
        code = generateJoinCode();
    } while (await Group_session.exists({ join_code: code }));

    return code;
}

// Display names are how members identify each other on screen, so they must be
// unique across the whole session — the host's name included.
function isDisplayNameTaken(session, display_name) {
    if (session.host_display_name === display_name) {
        return true;
    }
    return session.participants.some((p) => p.display_name === display_name);
}

// A user can act on a session's cart/readiness only if they are the host or a participant.
function isSessionMember(session, userId) {
    if (session.host.toString() === userId) {
        return true;
    }
    return session.participants.some((p) => p.user.toString() === userId);
}


// Create group session
const creategroupSessionfn = async (req, res) => {
    try {
        const result = validator.createGroupSessionValidator.safeParse(req.body);

        if (!result.success) {
            return res.status(400).json({ errors: result.error.issues });
        }

        const { userId, display_name } = result.data;

        const host = await User.findById(userId);

        if (!host) {
            return res.status(404).json({ mssg: "User not found" });
        }

        const code = await createUniqueJoinCode();

        const session = await Group_session.create({
            join_code: code,
            host: userId,
            host_display_name: display_name || host.username,
            active: true,
            participants: [],
            cart: []
        });

        return res.status(201).json({
            join_code: session.join_code,
            host_display_name: session.host_display_name
        });

    } catch (error) {
        return res.status(500).json({
            mssg: "Failed to create group session"
        });
    }
};


// Get current group state
const getGroupSessionfn = async (req, res) => {
    try {
        const { joinCode } = req.params;

        const state = await getGroupState(joinCode);

        if (!state) {
            return res.status(404).json({ mssg: "Group session not found" });
        }

        return res.status(200).json({ data: state });
    } catch (error) {
        return res.status(500).json({ mssg: "Failed to fetch group session" });
    }
};


// Join existing group
const joinGroupfn = async (req, res) => {
    try {
        const { joinCode } = req.params;

        const result = validator.groupJoinvalidators.safeParse(req.body);

        if (!result.success) {
            return res.status(400).json({
                errors: result.error.issues
            });
        }

        const { userId, display_name } = result.data;

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                mssg: "User not found"
            });
        }

        const session = await Group_session.findOne({
            join_code: joinCode,
            active: true
        });

        if (!session) {
            return res.status(404).json({
                mssg: "Active group session not found"
            });
        }

        // Host cannot join as a participant
        if (session.host.toString() === userId) {
            return res.status(409).json({
                mssg: "Host cannot join their own group as a participant"
            });
        }

        // A user cannot join the same session twice
        const alreadyJoined = session.participants.some(
            (participant) => participant.user.toString() === userId
        );

        if (alreadyJoined) {
            return res.status(409).json({
                mssg: "User has already joined this group session"
            });
        }

        // Check duplicate display name within this group (host's name included)
        if (isDisplayNameTaken(session, display_name)) {
            return res.status(409).json({
                mssg: "Display name already exists in this group"
            });
        }

        session.participants.push({
            user: userId,
            display_name,
            ready: false
        });

        await session.save();

        const state = await broadcastGroupState(joinCode);

        return res.status(200).json({ data: state });

    } catch (error) {
        return res.status(500).json({
            mssg: "Failed to join group"
        });
    }
};


// Toggle a participant's own ready status
const toggleReadyfn = async (req, res) => {
    try {
        const { joinCode, userId } = req.params;

        if (!isValidObjectId(userId)) {
            return res.status(400).json({ mssg: "Invalid user id" });
        }

        const result = validator.readyValidator.safeParse(req.body);

        if (!result.success) {
            return res.status(400).json({ errors: result.error.issues });
        }

        const { ready } = result.data;

        const session = await Group_session.findOne({ join_code: joinCode, active: true });

        if (!session) {
            return res.status(404).json({ mssg: "Active group session not found" });
        }

        const participant = session.participants.find((p) => p.user.toString() === userId);

        if (!participant) {
            return res.status(404).json({ mssg: "User is not a participant of this session" });
        }

        participant.ready = ready;
        await session.save();

        const state = await broadcastGroupState(joinCode);

        return res.status(200).json({ data: state });
    } catch (error) {
        return res.status(500).json({ mssg: "Failed to update ready status" });
    }
};


// Get participants only
const getParticipantsfn = async (req, res) => {
    try {
        const { joinCode } = req.params;

        const state = await getGroupState(joinCode);

        if (!state) {
            return res.status(404).json({ mssg: "Group session not found" });
        }

        return res.status(200).json({ data: state.participants });
    } catch (error) {
        return res.status(500).json({ mssg: "Failed to fetch participants" });
    }
};


// Host removes a participant from the session. Anything that participant put in
// the shared cart is dropped with them and its reserved stock handed back, so a
// kicked member never leaves stock locked up in a cart nobody can now edit.
const kickParticipantfn = async (req, res) => {
    try {
        const { joinCode, participantId } = req.params;

        if (!isValidObjectId(participantId)) {
            return res.status(400).json({ mssg: "Invalid user id" });
        }

        const result = validator.kickParticipantValidator.safeParse(req.query);

        if (!result.success) {
            return res.status(400).json({ errors: result.error.issues });
        }

        const { userId } = result.data;

        const session = await Group_session.findOne({ join_code: joinCode, active: true });

        if (!session) {
            return res.status(404).json({ mssg: "Active group session not found" });
        }

        if (session.host.toString() !== userId) {
            return res.status(403).json({ mssg: "Only the host can remove a participant" });
        }

        if (session.host.toString() === participantId) {
            return res.status(400).json({ mssg: "Host cannot be removed from the session" });
        }

        const participant = session.participants.find((p) => p.user.toString() === participantId);

        if (!participant) {
            return res.status(404).json({ mssg: "User is not a participant of this session" });
        }

        const wasAddedByParticipant = (item) => item.added_by?.toString() === participantId;

        for (const item of session.cart.filter(wasAddedByParticipant)) {
            await releaseStock(item.product.toString(), item.qty);
        }

        session.cart = session.cart.filter((item) => !wasAddedByParticipant(item));
        session.participants = session.participants.filter(
            (p) => p.user.toString() !== participantId
        );

        await session.save();

        // Tells the removed member's client it is out; everyone else just needs
        // the refreshed state that follows.
        emitToGroup(joinCode, "group:participant_removed", {
            join_code: joinCode,
            user: participantId,
            display_name: participant.display_name
        });

        const state = await broadcastGroupState(joinCode);

        return res.status(200).json({ data: state });
    } catch (error) {
        return res.status(500).json({ mssg: "Failed to remove participant" });
    }
};


// Get group cart only
const getGroupCartfn = async (req, res) => {
    try {
        const { joinCode } = req.params;

        const state = await getGroupState(joinCode);

        if (!state) {
            return res.status(404).json({ mssg: "Group session not found" });
        }

        return res.status(200).json({ data: state.cart });
    } catch (error) {
        return res.status(500).json({ mssg: "Failed to fetch group cart" });
    }
};


// Add an item to the shared group cart. One cart entry per product *per member* —
// a second POST for a product the caller already added is rejected; PATCH changes
// that caller's own quantity instead.
const addGroupCartItemfn = async (req, res) => {
    try {
        const { joinCode } = req.params;

        const result = validator.addGroupCartItemValidator.safeParse(req.body);

        if (!result.success) {
            return res.status(400).json({ errors: result.error.issues });
        }

        const { userId, productId, qty } = result.data;

        const session = await Group_session.findOne({ join_code: joinCode, active: true });

        if (!session) {
            return res.status(404).json({ mssg: "Active group session not found" });
        }

        if (!isSessionMember(session, userId)) {
            return res.status(403).json({ mssg: "User is not part of this group session" });
        }

        // The shared cart holds one line per product *per member*, so two people
        // ordering the same dish each keep their own line and their own qty.
        // Keying on product alone would hide the second person's contribution.
        const existing = session.cart.some(
            (item) =>
                item.product.toString() === productId &&
                item.added_by.toString() === userId
        );

        if (existing) {
            return res.status(409).json({ mssg: "You already added this item, use PATCH to change your quantity" });
        }

        const product = await reserveStock(productId, qty);

        if (!product) {
            return res.status(409).json({ mssg: "Insufficient stock" });
        }

        session.cart.push({ product: productId, qty, added_by: userId });
        await session.save();

        const state = await broadcastGroupState(joinCode);

        return res.status(201).json({ data: state });
    } catch (error) {
        return res.status(500).json({ mssg: "Failed to add item to group cart" });
    }
};


// Update quantity of an existing group cart item
const updateGroupCartItemfn = async (req, res) => {
    try {
        const { joinCode, productId } = req.params;

        const result = validator.updateGroupCartItemValidator.safeParse(req.body);

        if (!result.success) {
            return res.status(400).json({ errors: result.error.issues });
        }

        const { userId, qty } = result.data;

        const session = await Group_session.findOne({ join_code: joinCode, active: true });

        if (!session) {
            return res.status(404).json({ mssg: "Active group session not found" });
        }

        if (!isSessionMember(session, userId)) {
            return res.status(403).json({ mssg: "User is not part of this group session" });
        }

        // Only your own line — one member changing another's quantity would put
        // us back to a single shared number with no way to attribute it.
        const item = session.cart.find(
            (item) =>
                item.product.toString() === productId &&
                item.added_by.toString() === userId
        );

        if (!item) {
            return res.status(404).json({ mssg: "You have not added this item to the group cart" });
        }

        const delta = qty - item.qty;

        if (delta > 0) {
            const product = await reserveStock(productId, delta);
            if (!product) {
                return res.status(409).json({ mssg: "Insufficient stock" });
            }
        } else if (delta < 0) {
            await releaseStock(productId, -delta);
        }

        // added_by is deliberately NOT reassigned here: it records who put the
        // item in the cart, so a quantity change by someone else must not steal
        // the attribution. It is also what "kick a participant" uses to decide
        // which lines to drop.
        item.qty = qty;
        await session.save();

        const state = await broadcastGroupState(joinCode);

        return res.status(200).json({ data: state });
    } catch (error) {
        return res.status(500).json({ mssg: "Failed to update group cart item" });
    }
};


// Remove an item from the group cart, releasing its reserved stock
const removeGroupCartItemfn = async (req, res) => {
    try {
        const { joinCode, productId } = req.params;

        const result = validator.removeGroupCartItemValidator.safeParse(req.query);

        if (!result.success) {
            return res.status(400).json({ errors: result.error.issues });
        }

        const { userId } = result.data;

        const session = await Group_session.findOne({ join_code: joinCode, active: true });

        if (!session) {
            return res.status(404).json({ mssg: "Active group session not found" });
        }

        if (!isSessionMember(session, userId)) {
            return res.status(403).json({ mssg: "User is not part of this group session" });
        }

        const item = session.cart.find(
            (item) =>
                item.product.toString() === productId &&
                item.added_by.toString() === userId
        );

        if (!item) {
            return res.status(404).json({ mssg: "You have not added this item to the group cart" });
        }

        await releaseStock(productId, item.qty);

        session.cart = session.cart.filter(
            (line) =>
                !(
                    line.product.toString() === productId &&
                    line.added_by.toString() === userId
                )
        );
        await session.save();

        const state = await broadcastGroupState(joinCode);

        return res.status(200).json({ data: state });
    } catch (error) {
        return res.status(500).json({ mssg: "Failed to remove group cart item" });
    }
};


// Host places the group order. Stock was already reserved as items were added
// to the cart, so this only needs to snapshot the cart into an Order.
const placeGroupOrderfn = async (req, res) => {
    try {
        const { joinCode } = req.params;

        const result = validator.placeGroupOrderValidator.safeParse(req.body);

        if (!result.success) {
            return res.status(400).json({ errors: result.error.issues });
        }

        const { userId } = result.data;

        const session = await Group_session.findOne({ join_code: joinCode });

        if (!session) {
            return res.status(404).json({ mssg: "Group session not found" });
        }

        if (session.host.toString() !== userId) {
            return res.status(403).json({ mssg: "Only the host can place the group order" });
        }

        if (!session.active) {
            return res.status(409).json({ mssg: "Group order has already been placed for this session" });
        }

        if (session.participants.length === 0) {
            return res.status(400).json({ mssg: "Cannot place an order with no participants" });
        }

        if (session.cart.length === 0) {
            return res.status(400).json({ mssg: "Group cart is empty" });
        }

        const everyoneReady = session.participants.every((p) => p.ready);

        if (!everyoneReady) {
            return res.status(409).json({ mssg: "All participants must be ready before placing the order" });
        }

        // Atomically flip active -> false. Only one concurrent request can win this;
        // any other request (or retry) will find active already false and get null back.
        const claimed = await Group_session.findOneAndUpdate(
            { join_code: joinCode, active: true },
            { $set: { active: false } },
            { new: false }
        ).populate("cart.product");

        if (!claimed) {
            return res.status(409).json({ mssg: "Group order has already been placed for this session" });
        }

        // Display names live on the session, which the order must not depend on,
        // so each cart line carries the name of whoever added it into the order.
        const displayNames = new Map(
            claimed.participants.map((p) => [p.user.toString(), p.display_name])
        );
        displayNames.set(claimed.host.toString(), claimed.host_display_name);

        const products = claimed.cart.map((item) => ({
            product: item.product._id,
            name: item.product.name,
            price: item.product.price,
            qty: item.qty,
            added_by: item.added_by,
            added_by_name: displayNames.get(item.added_by?.toString()) || null
        }));

        const order_amt = products.reduce((sum, p) => sum + p.price * p.qty, 0);

        const order = await Order.create({
            order_date: new Date(),
            order_amt,
            order_status: "placed",
            order_type: "group",
            order_by_user: userId,
            grp_order: {
                join_code: claimed.join_code,
                host: claimed.host,
                host_display_name: claimed.host_display_name,
                grp_member: claimed.participants.map((p) => p.user),
                members: claimed.participants.map((p) => ({
                    user: p.user,
                    display_name: p.display_name
                }))
            },
            products
        });

        const memberIds = [claimed.host, ...claimed.participants.map((p) => p.user)];
        await User.updateMany({ _id: { $in: memberIds } }, { $push: { order_placed: order._id } });

        await broadcastGroupState(joinCode);

        return res.status(201).json({ data: order });
    } catch (error) {
        return res.status(500).json({ mssg: "Failed to place group order" });
    }
};


module.exports = {
    creategroupSessionfn,
    getGroupSessionfn,
    joinGroupfn,
    toggleReadyfn,
    getParticipantsfn,
    kickParticipantfn,
    getGroupCartfn,
    addGroupCartItemfn,
    updateGroupCartItemfn,
    removeGroupCartItemfn,
    placeGroupOrderfn
};
