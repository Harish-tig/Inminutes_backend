const mongoose = require('mongoose');
const mongo = require('../schemas/schema')

const User = mongoose.model('User', mongo.UserSchema)
const Order = mongoose.model('Order', mongo.OrderSchema)
const Product = mongoose.model('Product', mongo.ProductSchema)
const Group_session = mongoose.model('Group_session', mongo.GroupSessionSchema)


module.exports = {
    User,
    Order,
    Product,
    Group_session
}