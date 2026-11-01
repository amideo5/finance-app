import { colors } from '@/src/constants/colors';
import { Tabs } from 'expo-router';
import { Home, Receipt, Settings, Users, Wallet, TrendingUp } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { fontSize: 9, fontWeight: '700', marginTop: 1 },
        tabBarItemStyle: { flex: 1, minWidth: 0, paddingHorizontal: 0 },
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          height: 62 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 7),
          paddingTop: 7,
          elevation: 10,
          shadowColor: '#25264A',
          shadowOffset: { width: 0, height: -3 },
          shadowOpacity: 0.05,
          shadowRadius: 10,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ size, color }) => (
            <Home size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: 'Transactions',
          tabBarIcon: ({ size, color }) => (
            <Receipt size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Friends',
          tabBarIcon: ({ size, color }) => (
            <Users size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ size, color }) => (
            <Settings size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="investments"
        options={{
          title: 'Portfolio',
          tabBarIcon: ({ size, color }) => (
            <TrendingUp size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="accounts"
        options={{
          title: 'Accounts',
          tabBarIcon: ({ size, color }) => (
            <Wallet size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}