import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle, TextStyle } from 'react-native';
import { colors } from '@/src/constants/colors';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  size?: 'small' | 'medium' | 'large';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export default function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'medium',
  loading = false,
  disabled = false,
  style,
  textStyle,
}: ButtonProps) {
  const getButtonStyle = () => {
    const styles: ViewStyle[] = [baseStyles.button];

    if (variant === 'primary') styles.push(baseStyles.primaryButton);
    if (variant === 'secondary') styles.push(baseStyles.secondaryButton);
    if (variant === 'outline') styles.push(baseStyles.outlineButton);
    if (variant === 'danger') styles.push(baseStyles.dangerButton);

    if (size === 'small') styles.push(baseStyles.smallButton);
    if (size === 'large') styles.push(baseStyles.largeButton);

    if (disabled) styles.push(baseStyles.disabledButton);

    return styles;
  };

  const getTextStyle = () => {
    const styles: TextStyle[] = [baseStyles.text];

    if (variant === 'primary') styles.push(baseStyles.primaryText);
    if (variant === 'secondary') styles.push(baseStyles.secondaryText);
    if (variant === 'outline') styles.push(baseStyles.outlineText);
    if (variant === 'danger') styles.push(baseStyles.primaryText);

    if (size === 'small') styles.push(baseStyles.smallText);
    if (size === 'large') styles.push(baseStyles.largeText);

    return styles;
  };

  return (
    <TouchableOpacity
      style={[...getButtonStyle(), style]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'outline' ? colors.primary : '#FFFFFF'} />
      ) : (
        <Text style={[...getTextStyle(), textStyle]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const baseStyles = StyleSheet.create({
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
  secondaryButton: {
    backgroundColor: colors.secondary,
  },
  outlineButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  dangerButton: {
    backgroundColor: colors.danger,
  },
  disabledButton: {
    backgroundColor: colors.border,
    opacity: 0.6,
  },
  smallButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  largeButton: {
    paddingVertical: 18,
    paddingHorizontal: 32,
  },
  text: {
    fontSize: 16,
    fontWeight: '600',
  },
  primaryText: {
    color: '#FFFFFF',
  },
  secondaryText: {
    color: '#FFFFFF',
  },
  outlineText: {
    color: colors.primary,
  },
  smallText: {
    fontSize: 14,
  },
  largeText: {
    fontSize: 18,
  },
});
