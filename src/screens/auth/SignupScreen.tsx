import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowRight, Sparkles, ShieldCheck } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Input from '@/src/components/ui/Input';
import Button from '@/src/components/ui/Button';
import { colors } from '@/src/constants/colors';
import { useAuth } from '@/src/context/AuthContext';
import { validateEmail, validatePassword } from '@/src/utils/validators';

export default function SignupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSignup = async () => {
    setError('');

    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }

    if (!validateEmail(email)) {
      setError('Please enter a valid email');
      return;
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      setError(passwordValidation.message);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    const { error: signUpError } = await signUp(email, password, name);
    setLoading(false);

    if (signUpError) {
      setError(signUpError.message);
    } else {
      router.replace('/auth/login');
    }
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
          <Text style={styles.eyebrow}>GET STARTED</Text>
          <Text style={styles.title}>Create your{ '\n' }account</Text>
          <Text style={styles.subtitle}>
            A clearer view of your money starts here.
          </Text>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Your details</Text>
          <Text style={styles.formSubtitle}>Fill in the details below to get started.</Text>

          <View style={styles.field}>
            <Input
              label="Name"
              placeholder="Enter your name"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              autoComplete="name"
            />
          </View>

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

          <View style={styles.field}>
            <Input
              label="Password"
              placeholder="Create a password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
            />
          </View>

          <View style={styles.lastField}>
            <Input
              label="Confirm password"
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
            />
          </View>

          {error ? (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : null}

          <Button
            title="Create account"
            onPress={handleSignup}
            loading={loading}
            style={styles.button}
          />

          <View style={styles.securityNote}>
            <ShieldCheck size={16} color={colors.textSecondary} />
            <Text style={styles.securityText}>Your account details stay protected.</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account?</Text>
          <Button
            title="Sign in"
            onPress={() => router.back()}
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
    marginBottom: 34,
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
    marginBottom: 26,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.8,
    marginBottom: 10,
  },
  title: {
    fontSize: 34,
    lineHeight: 39,
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
    paddingHorizontal: 18,
    paddingTop: 21,
    paddingBottom: 18,
    shadowColor: '#000000',
    shadowOpacity: 0.035,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 7 },
    elevation: 2,
  },
  formTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: colors.text,
  },
  formSubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
    marginBottom: 21,
  },
  field: {
    marginBottom: 15,
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
    marginTop: 15,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },
  button: {
    marginTop: 22,
  },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 17,
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
    marginTop: 24,
  },
  footerText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
});
