import Button from '@/src/components/ui/Button';
import Input from '@/src/components/ui/Input';
import { colors } from '@/src/constants/colors';
import { useAuth } from '@/src/context/AuthContext';
import { validateEmail, validatePassword } from '@/src/utils/validators';
import { useRouter } from 'expo-router';
import { ArrowRight, WalletCards, ShieldCheck, Sparkles } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';


export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn, user } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Redirect to the app when the user is already authenticated.
  useEffect(() => {
    if (user) {
      router.replace('/(tabs)');
    }
  }, [user]);

  const handleLogin = async () => {
    setError('');

    if (!validateEmail(email)) {
      setError('Please enter a valid email');
      return;
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      setError(passwordValidation.message);
      return;
    }

    setLoading(true);
    const { error: signInError } = await signIn(email, password);
    setLoading(false);

    if (signInError) {
      console.log('LOGIN ERROR:', signInError);
      setError(signInError.message);
      return;
    }

    router.replace('/(tabs)');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(insets.top + 20, 36), paddingBottom: Math.max(insets.bottom, 20) + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandRow}>
          <View style={styles.brandIcon}>
            <Sparkles color={colors.primary} size={25} strokeWidth={2.2} />
          </View>
          <Text style={styles.brandName}>YOUR MONEY SPACE</Text>
        </View>

        <View style={styles.header}>
          <Text style={styles.eyebrow}>WELCOME BACK</Text>
          <Text style={styles.title}>Good to see{ '\n' }you again.</Text>
          <Text style={styles.subtitle}>Sign in to pick up where you left off.</Text>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Sign in</Text>
          <Text style={styles.formSubtitle}>Enter your account credentials to continue.</Text>

          <View style={styles.field}>
            <Input
              label="Email address"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
          </View>

          <View style={styles.lastField}>
            <Input
              label="Password"
              placeholder="Enter your password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
            />
          </View>

          {error ? (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : null}

          <Button
            title="Sign in"
            onPress={handleLogin}
            loading={loading}
            style={styles.button}
          />

          <View style={styles.securityNote}>
            <ShieldCheck size={16} color={colors.textSecondary} />
            <Text style={styles.securityText}>Sign in securely to your personal finances.</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>New to YOUR MONEY SPACE?</Text>
          <Button
            title="Create account"
            onPress={() => router.push('/auth/signup')}
            variant="outline"
            size="small"
          />
          <ArrowRight size={15} color={colors.primary} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 22,
    justifyContent: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: 38,
  },
  brandIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  brandName: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
    marginLeft: 11,
    letterSpacing: 0.2,
  },
  header: {
    marginBottom: 28,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.8,
    marginBottom: 10,
  },
  title: {
    fontSize: 35,
    lineHeight: 41,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    marginTop: 10,
  },
  formCard: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 19,
    paddingTop: 23,
    paddingBottom: 19,
    shadowColor: '#000000',
    shadowOpacity: 0.035,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 7 },
    elevation: 2,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  formSubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
    marginBottom: 23,
  },
  greeting: { fontSize: 10, letterSpacing: 1.5, color: '#D9D5FF', fontWeight: '800' },
  field: {
    marginBottom: 17,
  },
  lastField: {
    marginBottom: 0,
  },
  errorBox: {
    backgroundColor: colors.background,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 16,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },
  button: {
    marginTop: 25,
  },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    gap: 7,
  },
  securityText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 26,
  },
  footerText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
});
