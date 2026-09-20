const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({

    username: {
        type: String,
        required: true,
        unique: true
    },

    cart: [{
        product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product"
        },

        qty: {
            type: Number,
            min: 1
        }
    }],

    order_placed: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order"
    }]
});

// products stores a snapshot (name/price at time of order) since Product
// documents can change or be deleted after the order is placed.
const OrderSchema = new mongoose.Schema({

    order_date: Date,
    order_amt: Number,
    order_status: String,

    order_type: {
        type: String,
        enum: ["normal", "group"],
        required: true
    },

    order_by_user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    grp_order: {

        // The session this order came out of. The session document outlives the
        // order, but the order does not depend on it — everything the host log
        // needs is snapshotted here.
        join_code: String,

        host: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
        },

        host_display_name: String,

        // Participant ids only. Kept unchanged because orders already in the
        // database store it in this shape; `members` below is the richer
        // snapshot new orders are read from.
        grp_member: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
        }],

        // Participants with the display name they used in that session, so the
        // host log can name people without reading the session back.
        members: [{
            user: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User"
            },
            display_name: String
        }]
    },

    products: [{
        product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product"
        },
        name: String,
        price: Number,
        qty: Number,

        // Who put this line in the group cart. Snapshotted for the same reason
        // name/price are: the display name belongs to a session that may change.
        // Absent on normal orders and on group orders placed before this existed.
        added_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
        },
        added_by_name: String
    }]

});

const ProductSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },

    price: {
        type: Number,
        required: true,
        min: 1
    },

    qty: {
        type: Number,
        required: true,
        min: 0
    },

    instock: {
        type: Boolean,
        required: true
    },

    // Absolute URLs served by the media store (Cloudinary — see utils/utils.js).
    // First entry is the thumbnail a client should show in the product list.
    image_urls: [{
        type: String
    }]
});


const GroupSessionSchema = new mongoose.Schema({
    join_code: {
        type: String,
        required: true,
        unique: true
    },

    host: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    // The host is not a participant, so their display name is stored alongside
    // the host ref instead of in the participants array.
    //
    // Not required: sessions created before this field existed have no value for
    // it, and marking it required would make every save() on one of those
    // (a join, a ready toggle, any cart change) fail validation. getGroupState
    // falls back to the host's username when it is missing; new sessions always
    // get a value from the controller.
    host_display_name: String,

    participants: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
        },
        display_name: String,
        ready: Boolean
    }],

    cart: [{
        product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product"
        },
        qty: Number,
        added_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
        }
    }],

    active: Boolean

}, { timestamps: true });

module.exports = {
    UserSchema,
    OrderSchema,
    ProductSchema,
    GroupSessionSchema
};
