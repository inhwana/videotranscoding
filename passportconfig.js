//Reference: https://www.youtube.com/watch?v=-RCnNyD0L-s&list=PLZlA0Gpn_vH9yI1hwDVzWqu5sAfajcsBQ&index=4
const bcrypt = require('bcrypt')
const localstrategy = require('passport-local').Strategy


function initialize(passport, getusername, getuserid) {
    const authenticateuser = async (username, password, done) =>{
        const user = getusername(username)
        if(user == null){
            return done(null, false, {message:'Username does not exist'})
        }
        try {
            if(await bcrypt.compare(password, user.password)){
                return done (null, user)
            } else{
                return done ( null, false, {message: 'Incorrect Password'})
            }
        } catch (error) {
            return done(error)
        }
    }
    passport.use(new localstrategy({usernameField: 'username'},authenticateuser))
    passport.serializeUser((user,done)=>done(null,user.id))
    passport.deserializeUser((id,done)=>{return done(null,getuserid(id))})
}
module.exports = initialize