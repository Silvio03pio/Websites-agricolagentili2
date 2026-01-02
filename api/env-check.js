module.exports = (req, res) => {
  res.status(200).json({
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasSupabaseServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    hasResendKey: !!process.env.RESEND_API_KEY,
    hasToEmail: !!process.env.CONTACT_TO_EMAIL,
    hasFromEmail: !!process.env.CONTACT_FROM_EMAIL
  });
};
